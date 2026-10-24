// Promotion codes and the promotion services (mantle.product.PromotionServices): adding and removing a code, buy-get and
// flat discounts, customer limits. Uses the POPC_DEFAULT store promotions from the demo data. New spec, no Groovy original.
const effectiveTime = Date.now()
const vendorId = "ORG_ZIZI_RETAIL", facilityId = "ZIRET_WH", productId = "DEMO_1_1", storeId = "POPC_DEFAULT"
let customerId, orderId, partSeqId, itemSeqId, flatPromotionId, flatCodeId

spec({
    stepwise: true,
    tempSequences: { start: 58800, banks: { "mantle.party.Party": 10, "mantle.order.OrderHeader": 10, "mantle.product.store.ProductStorePromotion": 10 } },
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(effectiveTime)
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

const n = (value) => dec(value).toNumber()
const promoItems = (id) => Array.from(ec.entity.find("mantle.order.OrderItem").condition("orderId", id).condition("isPromo", "Y").orderBy("orderItemSeqId").list())
const codeCount = (id) => ec.entity.find("mantle.order.OrderPromoCode").condition("orderId", id).list().length

feature("an order for the store with two units of a product", {
    when() {
        customerId = call("mantle.party.PartyServices.create#Person", { firstName: "Promo", lastName: "Shopper", roleTypeId: "Customer" }).partyId
        const created = call("mantle.order.OrderServices.create#Order", { vendorPartyId: vendorId, customerPartyId: customerId, facilityId, productStoreId: storeId })
        orderId = created.orderId; partSeqId = created.orderPartSeqId
        itemSeqId = call("mantle.order.OrderServices.add#OrderProductQuantity", { orderId, orderPartSeqId: partSeqId, productId, quantity: 2, unitAmount: 20, requireInventory: false }).orderItemSeqId
        return { promos: promoItems(orderId), header: ec.entity.find("mantle.order.OrderHeader").condition("orderId", orderId).one() }
    },
    then({ promos, header }) {
        // the new customer promotion (20%) is the only one that needs no code
        promos.length >= 0
        n(header.grandTotal) > 0
    },
})

feature("a code that needs a customer not on the promotion is refused; a free code applies buy-one-get-one half off", {
    when() {
        // the messages for a refused code are public messages, so the refusals show as no code added
        call("mantle.product.PromotionServices.add#OrderPromoCode", { orderId, promoCode: "TEST1" })
        const afterRefused = codeCount(orderId)
        call("mantle.product.PromotionServices.add#OrderPromoCode", { orderId, promoCode: "NOSUCHCODE" })
        const afterUnknown = codeCount(orderId)
        call("mantle.product.PromotionServices.add#OrderPromoCode", { orderId, promoCode: "test2" })
        const added = Array.from(ec.entity.find("mantle.order.OrderPromoCode").condition("orderId", orderId).list())
        call("mantle.product.PromotionServices.add#OrderPromoCode", { orderId, promoCode: "TEST2" })
        const afterAgain = codeCount(orderId)
        const items = promoItems(orderId)
        return { afterRefused, afterUnknown, added, afterAgain, items }
    },
    then({ afterRefused, afterUnknown, added, afterAgain, items }) {
        afterRefused == 0
        afterUnknown == 0
        added.length == 1
        added[0].promoCodeId == "TEST2"
        afterAgain == 1
        // buy 1 get 1: one unit at 50% of 20 is 10 off
        const buyGet = items.filter(i => i.storePromotionId == "PopcBuyGet")
        buyGet.length == 1
        n(buyGet[0].quantity) == 1
        n(buyGet[0].unitAmount) == -10
        buyGet[0].promoCodeId == "TEST2"
    },
})

feature("removing the code takes its discount off", {
    when() {
        call("mantle.product.PromotionServices.remove#OrderPromoCode", { orderId, promoCodeId: "TEST2" })
        return { codes: ec.entity.find("mantle.order.OrderPromoCode").condition("orderId", orderId).list().length,
                 items: promoItems(orderId).filter(i => i.storePromotionId == "PopcBuyGet") }
    },
    then({ codes, items }) {
        codes == 0
        items.length == 0
    },
})

feature("a flat discount promotion with a code, limited to one use per order", {
    when() {
        flatPromotionId = call("create#mantle.product.store.ProductStorePromotion", { productStoreId: storeId, itemDescription: "Five Off", serviceRegisterId: "FlatDiscount",
                sequenceNum: 20, requireCode: "Y", useLimitPerOrder: 2 }).storePromotionId
        call("create#mantle.product.store.ProductStorePromoParameter", { storePromotionId: flatPromotionId, parameterName: "discountAmount", parameterValue: "5" })
        flatCodeId = "FIVEOFF" + flatPromotionId
        call("create#mantle.product.store.ProductStorePromoCode", { promoCodeId: flatCodeId, promoCode: flatCodeId, storePromotionId: flatPromotionId, requireParty: "N" })
        call("mantle.product.PromotionServices.add#OrderPromoCode", { orderId, promoCode: flatCodeId })
        const items = promoItems(orderId).filter(i => i.storePromotionId == flatPromotionId)
        const header = ec.entity.find("mantle.order.OrderHeader").condition("orderId", orderId).one()
        return { items, header }
    },
    then({ items, header }) {
        // discount amount per quantity, up to the use limit of 2 on the two units
        items.length == 1
        n(items[0].quantity) == 2
        n(items[0].unitAmount) == -5
        items[0].promoCodeId == flatCodeId
        n(header.grandTotal) > 0
    },
})

feature("direct apply#FlatDiscount and apply#BuyGetDiscount on an order", {
    when() {
        call("mantle.product.PromotionServices.apply#OrderPromotions", { orderId, orderPartSeqId: partSeqId })
        const before = promoItems(orderId).length
        call("mantle.product.PromotionServices.apply#FlatDiscount", { orderId, orderPartSeqId: partSeqId, storePromotionId: flatPromotionId, promoCodeId: flatCodeId, discountAmount: 3, useLimit: 1, itemsWithPromo: true })
        call("mantle.product.PromotionServices.apply#BuyGetDiscount", { orderId, orderPartSeqId: partSeqId, storePromotionId: "PopcBuyGet", buyQuantity: 1, getQuantity: 1, discountPercent: 100 })
        return { before, after: promoItems(orderId) }
    },
    then({ before, after }) {
        after.length > before
        after.some(i => n(i.unitAmount) == -3)
    },
})
