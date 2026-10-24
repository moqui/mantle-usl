// Port of AssetReservationMultipleThreads.groovy: five threads each place an order for DEMO_1_1 and DEMO_UNIT without
// requiring inventory; the total ATP must then equal the negated total quantityNotAvailable of the reservations.
const effectiveTime = Date.now()

spec({
    tempSequences: { start: 55300, banks: {
        "mantle.order.OrderHeader": 20, "mantle.product.asset.Asset": 20,
        "mantle.product.asset.AssetDetail": 20, "mantle.product.issuance.AssetReservation": 20 } },
    setupSpec() {
        ec.user.setEffectiveTime(effectiveTime)
        login("john.doe")
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

feature("Asset reservation from multiple threads", {
    when() {
        const numThreads = 5
        let assetList = ec.entity.find("mantle.product.asset.Asset").condition("productId", "DEMO_1_1").list()
        const initialAtp = sum(assetList, "availableToPromiseTotal")
        log.info("Initial ATP of DEMO_1_1 is " + String(initialAtp))

        // makeOrder from the Groovy, run on numThreads threads each in its own transaction (ec.transaction.begin/commit)
        const orderIds = parallel(numThreads, (threadNum, args) => {
            ec.user.setEffectiveTime(args.effectiveTime + threadNum)
            ec.user.loginUser("joe@public.com", "moqui")
            ec.artifactExecution.disableAuthz()

            const productStoreId = "POPC_DEFAULT"
            const productStore = ec.entity.find("mantle.product.store.ProductStore")
                .condition("productStoreId", productStoreId).useCache(true).one()
            const currencyUomId = productStore.defaultCurrencyUomId
            const customerPartyId = ec.user.userAccount.partyId

            const productIds = ["DEMO_1_1", "DEMO_UNIT"]
            const firstIdx = threadNum % 2
            const secondIdx = firstIdx == 0 ? 1 : 0

            // first item, create order
            const addOut1 = ec.service.sync().name("mantle.order.OrderServices.add#OrderProductQuantity")
                .parameters({ productId: productIds[firstIdx], quantity: 60, customerPartyId: customerPartyId,
                    currencyUomId: currencyUomId, productStoreId: productStoreId, requireInventory: false }).call()
            const cartOrderId = addOut1.orderId
            const orderPartSeqId = addOut1.orderPartSeqId

            // second item, add to order
            ec.service.sync().name("mantle.order.OrderServices.add#OrderProductQuantity")
                .parameters({ orderId: cartOrderId, orderPartSeqId: orderPartSeqId,
                    productId: productIds[secondIdx], quantity: 60, customerPartyId: customerPartyId,
                    currencyUomId: currencyUomId, productStoreId: productStoreId, requireInventory: false }).call()

            ec.service.sync().name("mantle.order.OrderServices.set#OrderBillingShippingInfo")
                .parameters({ orderId: cartOrderId, paymentMethodId: "CustJqpCc", paymentInstrumentEnumId: "PiCreditCard",
                    shippingPostalContactMechId: "CustJqpAddr", shippingTelecomContactMechId: "CustJqpTeln",
                    carrierPartyId: "_NA_", shipmentMethodEnumId: "ShMthGround" }).call()
            // place#Order triggers the asset reservation
            ec.service.sync().name("mantle.order.OrderServices.place#Order")
                .parameters({ orderId: cartOrderId, requireInventory: false }).call()

            ec.user.logoutUser()
            return String(cartOrderId)
        }, { effectiveTime }, { timeout: 30 })

        assetList = ec.entity.find("mantle.product.asset.Asset").condition("productId", "DEMO_1_1").list()
        const afterAtp = sum(assetList, "availableToPromiseTotal")
        log.info("After ATP of DEMO_1_1 is " + String(afterAtp) + " " + JSON.stringify(assetList.map(a => ({ assetId: a.assetId, availableToPromiseTotal: String(a.availableToPromiseTotal) }))))

        const resList = ec.entity.find("mantle.product.issuance.AssetReservation").condition("productId", "DEMO_1_1").list()
        const totalNotAvailable = sum(resList, "quantityNotAvailable")
        log.info("After DEMO_1_1 AssetReservation not available " + String(totalNotAvailable))
        return { orderIds, afterAtp, totalNotAvailable }
    },
    then({ orderIds, afterAtp, totalNotAvailable }) {
        orderIds.length == 5
        afterAtp == dec(totalNotAvailable).negate()
    },
})
