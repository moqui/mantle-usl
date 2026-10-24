// Port of OrderToCashTime.groovy: create and ship several sales orders, logging the time taken.
spec({
    dependsOn: ["OrderToCashBasicFlow"],
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

feature("Sales Order Time Check", {
    when() {
        const numOrders = 5

        const startTime = Date.now()
        for (let i = 0; i < numOrders; i++) {
            login("joe@public.com")

            const productStoreId = "POPC_DEFAULT"
            const productStore = ec.entity.find("mantle.product.store.ProductStore").condition("productStoreId", productStoreId).useCache(true).one()
            const currencyUomId = productStore.defaultCurrencyUomId
            const customerPartyId = ec.user.userAccount.partyId

            const addOut1 = call("mantle.order.OrderServices.add#OrderProductQuantity",
                    { productId: 'DEMO_1_1', quantity: 1, customerPartyId: customerPartyId,
                        currencyUomId: currencyUomId, productStoreId: productStoreId })

            const cartOrderId = addOut1.orderId
            const orderPartSeqId = addOut1.orderPartSeqId

            call("mantle.order.OrderServices.add#OrderProductQuantity",
                    { orderId: cartOrderId, productId: 'DEMO_3_1', quantity: 1, customerPartyId: customerPartyId,
                        currencyUomId: currencyUomId, productStoreId: productStoreId })
            call("mantle.order.OrderServices.add#OrderProductQuantity",
                    { orderId: cartOrderId, productId: 'DEMO_2_1', quantity: 1, customerPartyId: customerPartyId,
                        currencyUomId: currencyUomId, productStoreId: productStoreId, requireInventory: false })

            call("mantle.order.OrderServices.set#OrderBillingShippingInfo",
                    { orderId: cartOrderId, paymentMethodId: 'CustJqpCc', shippingPostalContactMechId: 'CustJqpAddr',
                        shippingTelecomContactMechId: 'CustJqpTeln', carrierPartyId: '_NA_', shipmentMethodEnumId: 'ShMthGround' })
            call("mantle.order.OrderServices.place#Order", { orderId: cartOrderId, requireInventory: false })

            logout()

            login("john.doe")
            // explicitly approve order as john.doe (has pre-approve warnings for unavailable inventory so must be done explicitly)
            call("mantle.order.OrderServices.approve#Order", { orderId: cartOrderId })
            call("mantle.shipment.ShipmentServices.ship#OrderPart", { orderId: cartOrderId, orderPartSeqId: orderPartSeqId })
            logout()

            log.info(`[${i + 1}/${numOrders} - ${Date.now() - startTime}] Created and shipped order ${cartOrderId}`)
        }
        const endTime = Date.now()
        const seconds = (endTime - startTime) / 1000
        log.info(`Created and shipped ${numOrders} in ${seconds} seconds, ${numOrders / seconds} orders per second`)
    },
    then() {
        true
    },
})
