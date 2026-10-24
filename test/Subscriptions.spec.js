// Subscriptions bought through order items: approving an order of a product with a subscription resource creates the
// subscription, and a later order for the same customer starts where the earlier one ends. New spec, no Groovy original.
const effectiveTime = Date.now()
const vendorId = "ORG_ZIZI_RETAIL", facilityId = "ZIRET_WH", productId = "DEMO_DIG_SER", customerId = "JoeDist"
let first, second

spec({
    stepwise: true,
    tempSequences: { start: 59700, banks: { "mantle.order.OrderHeader": 10, "mantle.product.subscription.Subscription": 10 } },
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(effectiveTime)
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

function sixMonthsAfter(millis) {
    const from = new Date(millis)
    const first = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 6, 1))
    const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
    return Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(from.getUTCDate(), lastDay), from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds())
}
const subscriptions = () => Array.from(ec.entity.find("mantle.product.subscription.Subscription").condition("subscriberPartyId", customerId).condition("productId", productId).orderBy("fromDate").list())
function approvedOrder(quantity) {
    const created = call("mantle.order.OrderServices.create#Order", { vendorPartyId: vendorId, customerPartyId: customerId, facilityId })
    call("mantle.order.OrderServices.add#OrderProductQuantity", { orderId: created.orderId, orderPartSeqId: created.orderPartSeqId, productId, quantity, unitAmount: 20, requireInventory: false })
    call("mantle.order.OrderServices.set#OrderBillingShippingInfo", { orderId: created.orderId, orderPartSeqId: created.orderPartSeqId, shippingPostalContactMechId: "JoeDistAddr", carrierPartyId: "_NA_", shipmentMethodEnumId: "ShMthGround" })
    call("mantle.order.OrderServices.place#Order", { orderId: created.orderId, requireInventory: false })
    call("mantle.order.OrderServices.approve#Order", { orderId: created.orderId })
    return created.orderId
}

feature("a product with a subscription resource: approving an order starts a subscription for the quantity", {
    when() {
        call("create#mantle.product.subscription.SubscriptionResource", { subscriptionResourceId: "SUBTEST1", description: "Test resource" })
        call("create#mantle.product.subscription.ProductSubscriptionResource", { productId, subscriptionResourceId: "SUBTEST1", fromDate: effectiveTime - 86400000,
                availableTime: 3, availableTimeUomId: "TF_mon" })
        first = approvedOrder(2)
        return { list: subscriptions() }
    },
    then({ list }) {
        list.length == 1
        list[0].orderId == first
        list[0].subscriptionResourceId == "SUBTEST1"
        list[0].subscriptionTypeEnumId == "StProduct"
        // the subscription starts at the product resource's from date, and two units of three months each end six months later
        String(list[0].fromDate) == String(effectiveTime - 86400000)
        String(list[0].thruDate) == String(sixMonthsAfter(effectiveTime - 86400000))
    },
})

feature("a second order makes a second subscription, again from the product resource's from date", {
    when() {
        second = approvedOrder(1)
        return { list: subscriptions() }
    },
    then({ list }) {
        list.length == 2
        // approving passes the product resource's from date, so the renewal chaining (from the last thru date) applies only when none is given
        String(list[1].fromDate) == String(effectiveTime - 86400000)
        list[1].orderId == second
        list[1].thruDate != null
    },
})

feature("an order for a product with no subscription resource makes none", {
    when() {
        const before = ec.entity.find("mantle.product.subscription.Subscription").count()
        const created = call("mantle.order.OrderServices.create#Order", { vendorPartyId: vendorId, customerPartyId: customerId, facilityId })
        call("mantle.order.OrderServices.add#OrderProductQuantity", { orderId: created.orderId, orderPartSeqId: created.orderPartSeqId, productId: "DEMO_1_1", quantity: 1, unitAmount: 5, requireInventory: false })
        call("mantle.order.OrderServices.set#OrderBillingShippingInfo", { orderId: created.orderId, orderPartSeqId: created.orderPartSeqId, shippingPostalContactMechId: "JoeDistAddr", carrierPartyId: "_NA_", shipmentMethodEnumId: "ShMthGround" })
        call("mantle.order.OrderServices.place#Order", { orderId: created.orderId, requireInventory: false })
        call("mantle.order.OrderServices.approve#Order", { orderId: created.orderId })
        return { before, after: ec.entity.find("mantle.product.subscription.Subscription").count() }
    },
    then({ before, after }) { after == before },
})
