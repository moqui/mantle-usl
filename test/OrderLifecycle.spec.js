// Order edits, status changes, cloning, merging, recurring orders and content: the order services the flows do not
// reach. Uses ORG_ZIZI_RETAIL as vendor and the demo customer JoeDist with inventory not required. New spec, no Groovy
// original.
const vendorPartyId = "ORG_ZIZI_RETAIL", customerPartyId = "JoeDist", facilityId = "ZIRET_WH"
const effectiveTime = Date.now()
let orderId, partSeqId, itemSeqId, secondItemSeqId, otherOrderId, otherPartSeqId, cloneOrderId

spec({
    stepwise: true,
    tempSequences: { start: 57200, banks: { "mantle.order.OrderHeader": 20, "mantle.account.payment.Payment": 10 } },
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(effectiveTime)
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

const n = (value) => dec(value).toNumber()
const near = (a, b) => Math.abs(a - b) < 0.005
function errorOf(name, params) {
    try { call(name, params) } catch (e) { ec.message.clearErrors(); return String(e.message) }
    return null
}
const header = (id) => ec.entity.find("mantle.order.OrderHeader").condition("orderId", id).one()
const part = (id, seq) => ec.entity.find("mantle.order.OrderPart").condition("orderId", id).condition("orderPartSeqId", seq).one()
const items = (id) => Array.from(ec.entity.find("mantle.order.OrderItem").condition("orderId", id).orderBy("orderItemSeqId").list())
function newOrder() {
    const out = call("mantle.order.OrderServices.create#Order", { vendorPartyId, customerPartyId, facilityId })
    return { orderId: out.orderId, partSeqId: out.orderPartSeqId }
}

feature("create an order with items and an extra part", {
    when() {
        ({ orderId, partSeqId } = newOrder())
        itemSeqId = call("mantle.order.OrderServices.add#OrderProductQuantity", { orderId, orderPartSeqId: partSeqId, productId: "DEMO_1_1", quantity: 3, unitAmount: 10, requireInventory: false }).orderItemSeqId
        secondItemSeqId = call("mantle.order.OrderServices.create#OrderItem", { orderId, orderPartSeqId: partSeqId, itemTypeEnumId: "ItemShipping", itemDescription: "Shipping", quantity: 1, unitAmount: 5 }).orderItemSeqId
        const extraPartSeqId = call("mantle.order.OrderServices.create#OrderPart", { orderId, customerPartyId, vendorPartyId, facilityId }).orderPartSeqId
        call("mantle.order.OrderServices.update#OrderHeader", { orderId, orderName: "Lifecycle order" })
        return { extraPartSeqId, header: header(orderId) }
    },
    then({ extraPartSeqId, header }) {
        itemSeqId != null
        extraPartSeqId != partSeqId
        header.orderName == "Lifecycle order"
        n(header.grandTotal) == 35
    },
})

feature("change quantities and amounts and recalculate", {
    when() {
        call("mantle.order.OrderServices.update#OrderProductQuantity", { orderId, orderItemSeqId: itemSeqId, quantity: 4 })
        call("mantle.order.OrderServices.update#OrderItem", { orderId, orderItemSeqId: secondItemSeqId, unitAmount: 6 })
        call("mantle.order.OrderServices.recalc#OrderItemAmount", { orderId, orderItemSeqId: itemSeqId })
        call("mantle.order.OrderServices.recalc#OrderPartItemAmounts", { orderId, orderPartSeqId: partSeqId })
        call("mantle.order.OrderServices.update#OrderHeaderTotal", { orderId })
        const total = call("mantle.order.OrderServices.get#OrderItemTotal", { orderItem: items(orderId)[0] })
        return { header: header(orderId), total }
    },
    then({ header, total }) {
        // changing a quantity prices the item again, so the amounts are the item's own: the grand total is their sum
        n(items(orderId)[0].quantity) == 4
        n(items(orderId)[1].unitAmount) == 6
        near(n(header.grandTotal), items(orderId).reduce((sum, i) => sum + n(i.quantity) * n(i.unitAmount), 0))
        near(n(total.itemTotal), n(items(orderId)[0].quantity) * n(items(orderId)[0].unitAmount))
    },
})

feature("order info lookups", {
    when() {
        const display = call("mantle.order.OrderInfoServices.get#OrderDisplayInfo", { orderId })
        const count = call("mantle.order.OrderInfoServices.get#OrderItemsTotalCount", { orderId })
        const itemInfo = call("mantle.order.OrderInfoServices.get#OrderItemDisplayInfo", { orderId, orderItemSeqId: itemSeqId })
        const billing = call("mantle.order.OrderInfoServices.get#OrderPartBillingAddress", { orderId, orderPartSeqId: partSeqId })
        const manual = call("mantle.order.OrderInfoServices.validate#OrderRequireManual", { orderId })
        return { display, count, itemInfo, billing, manual }
    },
    then({ display, count, itemInfo, billing, manual }) {
        display.orderHeader.orderId == orderId
        count != null
        itemInfo != null
        billing != null
        manual != null
    },
})

feature("clone the order and merge another order's items", {
    when() {
        const cloned = call("mantle.order.OrderServices.clone#Order", { baseOrderId: orderId })
        cloneOrderId = cloned.orderId
        ;({ orderId: otherOrderId, partSeqId: otherPartSeqId } = newOrder())
        call("mantle.order.OrderServices.add#OrderProductQuantity", { orderId: otherOrderId, orderPartSeqId: otherPartSeqId, productId: "DEMO_3_1", quantity: 2, unitAmount: 5.5, requireInventory: false })
        call("mantle.order.OrderServices.merge#OrderItems", { orderId, fromOrderId: otherOrderId })
        return { cloneItems: items(cloneOrderId).length, baseItems: items(orderId).map(i => i.productId).filter(p => p), cloned }
    },
    then({ cloneItems, baseItems, cloned }) {
        cloned.orderId != orderId
        // productItemsOnly: the shipping item is not copied
        cloneItems == 1
        baseItems.includes("DEMO_3_1")
    },
})

feature("order content text and the 50/50 payment split", {
    when() {
        const contentId = call("mantle.order.OrderServices.create#OrderContent", { orderId, orderContentTypeEnumId: "OctOther", description: "po note" }).orderContentId
        call("mantle.order.OrderServices.update#OrderContent", { orderContentId: contentId, description: "po note edited" })
        const orderFileId = call("mantle.order.OrderServices.create#OrderContent", { orderId, orderContentTypeEnumId: "OctOther", contentFile: uploadedFile("po.txt", "purchase order") }).orderContentId
        call("mantle.order.OrderServices.update#OrderContent", { orderContentId: orderFileId, contentFile: uploadedFile("po2.txt", "purchase order 2") })
        call("mantle.order.OrderServices.create#OrderPayments50Split", { orderId, orderPartSeqId: partSeqId, fromPartyId: customerPartyId, toPartyId: vendorPartyId, amount: 100, paymentInstrumentEnumId: "PiCompanyCheck",
                dueDate: effectiveTime + 30 * 86400000 })
        const payments = Array.from(ec.entity.find("mantle.account.payment.Payment").condition("orderId", orderId).list())
        return { contentId, payments }
    },
    then({ contentId, payments }) {
        contentId != null
        payments.length == 2
        payments.map(p => n(p.amount)).sort().join(",") == "50,50"
    },
})

feature("place, propose and approve, then complete the order", {
    when() {
        call("mantle.order.OrderServices.set#OrderBillingShippingInfo", { orderId, orderPartSeqId: partSeqId, shippingPostalContactMechId: "JoeDistAddr", carrierPartyId: "_NA_", shipmentMethodEnumId: "ShMthGround" })
        call("mantle.order.OrderServices.place#Order", { orderId, requireInventory: false })
        const placed = header(orderId).statusId
        call("mantle.order.OrderServices.approve#Order", { orderId })
        const approved = header(orderId).statusId
        call("mantle.order.OrderServices.autoApprove#OrdersDelayed", {})
        const stillCompleteCheck = call("mantle.order.OrderServices.checkCancelComplete#Order", { orderId })
        const rejectedCheck = call("mantle.order.OrderServices.checkRejectedComplete#Order", { orderId })
        call("mantle.order.OrderServices.complete#Order", { orderId })
        return { placed, approved, stillCompleteCheck, rejectedCheck, completed: header(orderId).statusId }
    },
    then({ placed, approved, completed }) {
        placed == "OrderPlaced"
        approved == "OrderApproved"
        completed == "OrderCompleted"
    },
})

feature("cancel an item and a part, reject an item, a part and an order", {
    when() {
        const a = newOrder()
        const aItem = call("mantle.order.OrderServices.add#OrderProductQuantity", { orderId: a.orderId, orderPartSeqId: a.partSeqId, productId: "DEMO_1_1", quantity: 2, unitAmount: 10, requireInventory: false }).orderItemSeqId
        call("mantle.order.OrderServices.place#Order", { orderId: a.orderId, requireInventory: false })
        const cancelItem = call("mantle.order.OrderServices.cancel#OrderItem", { orderId: a.orderId, orderItemSeqId: aItem, checkCancelPart: false })
        const itemAfter = items(a.orderId).find(i => i.orderItemSeqId == aItem)

        const b = newOrder()
        call("mantle.order.OrderServices.add#OrderProductQuantity", { orderId: b.orderId, orderPartSeqId: b.partSeqId, productId: "DEMO_1_1", quantity: 1, unitAmount: 10, requireInventory: false })
        call("mantle.order.OrderServices.place#Order", { orderId: b.orderId, requireInventory: false })
        call("mantle.order.OrderServices.cancel#OrderPart", { orderId: b.orderId, orderPartSeqId: b.partSeqId })

        const c = newOrder()
        const cItem = call("mantle.order.OrderServices.add#OrderProductQuantity", { orderId: c.orderId, orderPartSeqId: c.partSeqId, productId: "DEMO_1_1", quantity: 1, unitAmount: 10, requireInventory: false }).orderItemSeqId
        call("mantle.order.OrderServices.place#Order", { orderId: c.orderId, requireInventory: false })
        call("mantle.order.OrderServices.reject#OrderItem", { orderId: c.orderId, orderItemSeqId: cItem, checkRejectedPart: false })

        const d = newOrder()
        call("mantle.order.OrderServices.add#OrderProductQuantity", { orderId: d.orderId, orderPartSeqId: d.partSeqId, productId: "DEMO_1_1", quantity: 1, unitAmount: 10, requireInventory: false })
        call("mantle.order.OrderServices.place#Order", { orderId: d.orderId, requireInventory: false })
        call("mantle.order.OrderServices.reject#OrderPart", { orderId: d.orderId, orderPartSeqId: d.partSeqId })

        const e = newOrder()
        call("mantle.order.OrderServices.add#OrderProductQuantity", { orderId: e.orderId, orderPartSeqId: e.partSeqId, productId: "DEMO_1_1", quantity: 1, unitAmount: 10, requireInventory: false })
        call("mantle.order.OrderServices.place#Order", { orderId: e.orderId, requireInventory: false })
        call("mantle.order.OrderServices.reject#Order", { orderId: e.orderId })
        return { cancelItem, itemAfter, b: part(b.orderId, b.partSeqId), cRejected: n(items(c.orderId)[0].quantityCancelled), d: part(d.orderId, d.partSeqId), e: header(e.orderId) }
    },
    then({ cancelItem, itemAfter, b, cRejected, d, e }) {
        n(cancelItem.quantityCancelled) == 2
        n(itemAfter.quantityCancelled) == 2
        b.statusId == "OrderCancelled"
        cRejected == 1
        d.statusId == "OrderRejected"
        e.statusId == "OrderRejected"
    },
})

feature("recurring orders", {
    when() {
        const r = newOrder()
        call("mantle.order.OrderServices.add#OrderProductQuantity", { orderId: r.orderId, orderPartSeqId: r.partSeqId, productId: "DEMO_1_1", quantity: 1, unitAmount: 10, requireInventory: false })
        call("mantle.order.OrderServices.set#OrderBillingShippingInfo", { orderId: r.orderId, orderPartSeqId: r.partSeqId, shippingPostalContactMechId: "JoeDistAddr", carrierPartyId: "_NA_", shipmentMethodEnumId: "ShMthGround" })
        call("mantle.order.OrderServices.place#Order", { orderId: r.orderId, requireInventory: false })
        call("mantle.order.OrderServices.approve#Order", { orderId: r.orderId })
        // run on the first of the month at 06:00; a base order never run has no last ordered date, so it is due
        call("mantle.order.OrderServices.update#OrderRecur", { orderId: r.orderId, recurCronExpression: "0 0 6 1 * ?", recurAutoInvoice: "Y" })
        const bad = errorOf("mantle.order.OrderServices.update#OrderRecur", { orderId: r.orderId, recurCronExpression: "not a cron" })
        const recur = header(r.orderId)
        const copy = call("mantle.order.OrderServices.create#RecurringOrder", { baseOrderId: r.orderId })
        call("mantle.order.OrderServices.create#RecurringOrders", {})
        const base = header(r.orderId)
        const display = call("mantle.order.OrderInfoServices.get#OrderDisplayInfo", { orderId: r.orderId })
        return { bad, recur, copy, base, display }
    },
    then({ bad, recur, copy, base, display }) {
        display.recurCronDescription.length > 0
        bad.includes("Invalid Cron expression")
        recur.recurCronExpression == "0 0 6 1 * ?"
        copy.orderId != null
        base.lastOrderedDate != null
        header(copy.orderId).parentOrderId != null
    },
})

feature("propose an order", {
    when() {
        const created = newOrder()
        call("mantle.order.OrderServices.add#OrderProductQuantity", { orderId: created.orderId, orderPartSeqId: created.partSeqId, productId: "DEMO_1_1", quantity: 1, unitAmount: 9, requireInventory: false })
        call("mantle.order.OrderServices.propose#Order", { orderId: created.orderId })
        return { status: header(created.orderId).statusId }
    },
    then({ status }) { status == "OrderProposed" },
})
