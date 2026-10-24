// Port of RestApiTests.groovy: the Moqui Tools REST API (service REST) through ScreenTest, order to cash with a pinned id range.
const token = 'TestSessionToken'
let restTest

spec({
    dependsOn: ["WorkPlanToCashBasicFlow"],
    tempSequences: { start: 55800, banks: {
        "mantle.account.method.PaymentGatewayResponse": 10,
        "mantle.ledger.transaction.AcctgTrans": 10,
        "mantle.shipment.Shipment": 10,
        "mantle.shipment.ShipmentItemSource": 10,
        "mantle.product.asset.Asset": 10,
        "mantle.product.asset.AssetDetail": 10,
        "mantle.product.issuance.AssetReservation": 10,
        "mantle.product.issuance.AssetIssuance": 10,
        "mantle.account.invoice.Invoice": 10,
        "mantle.account.payment.Payment": 10,
        "mantle.account.payment.PaymentApplication": 10,
        "mantle.order.OrderHeader": 10,
        "mantle.order.OrderItemBilling": 10 } },
    setupSpec() {
        login("john.doe")
        restTest = screenTest("rest")
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

feature("calculate GL Account Org Summaries for Accounting Tests", {
    when() {
        // this is very late in the mantle tests, do this here to get all data
        // recalculate summaries, create GlAccountOrgTimePeriod records
        call("mantle.ledger.LedgerServices.recalculate#GlAccountOrgSummaries", {})
    },
    then() {
        true
    },
})

feature("call Moqui Tools REST API (#requestMethod, #screenPath, #containsTextList)", {
    where: [
        // Order to Cash
        // TODO: better to not require session token in Service REST API calls?
        { requestMethod: "put", screenPath: "s1/mantle/orders/productQuantity", parameters: { productId: 'DEMO_1_1', quantity: 1, customerPartyId: 'CustJqp',
                productStoreId: 'POPC_DEFAULT', moquiSessionToken: token }, containsTextList: ['55800'] },
        { requestMethod: "put", screenPath: "s1/mantle/orders/productQuantity", parameters: { productId: 'DEMO_1_1', quantity: 1, orderId: '55800',
                moquiSessionToken: token }, containsTextList: ['55800', '01'] },
        { requestMethod: "put", screenPath: "s1/mantle/orders/55800/shippingBilling", parameters: { paymentMethodId: 'CustJqpCc',
                shippingPostalContactMechId: 'CustJqpAddr', shippingTelecomContactMechId: 'CustJqpTeln',
                carrierPartyId: '_NA_', shipmentMethodEnumId: 'ShMthGround', moquiSessionToken: token }, containsTextList: ['paymentId', '55800'] },
        { requestMethod: "post", screenPath: "s1/mantle/orders/55800/place", parameters: { moquiSessionToken: token }, containsTextList: ['"statusChanged" : true'] },
        { requestMethod: "post", screenPath: "s1/mantle/orders/55800/approve", parameters: { moquiSessionToken: token }, containsTextList: ['"statusChanged" : true'] },
        { requestMethod: "get", screenPath: "s1/mantle/payments/55800", parameters: null, containsTextList: ['CustJqpCc', 'PiCreditCard', 'PmntAuthorized', 'ORG_ZIZI_RETAIL'] },
        { requestMethod: "get", screenPath: "s1/mantle/orders/55800/items/01/reservations", parameters: null, containsTextList:
                ['"assetReservationId" : "55800"', '"orderId" : "55800"', '"productId" : "DEMO_1_1"'] },

        { requestMethod: "post", screenPath: "s1/mantle/orders/55800/parts/01/shipments", parameters: { moquiSessionToken: token }, containsTextList: ['"shipmentId" : "55800"'] },
        { requestMethod: "get", screenPath: "s1/mantle/orders/55800/items/01/billings", parameters: null, containsTextList: ['"orderItemBillingId" : "55800"', '"orderId" : "55800"',
                '"orderItemSeqId" : "01"', '"invoiceId" : "55800"', '"assetIssuanceId" : "55800"', '"shipmentId" : "55800"'] },
        { requestMethod: "get", screenPath: "s1/mantle/orders/55800/items/01/shipments", parameters: null, containsTextList: ['"shipmentItemSourceId" : "55800"',
                '"shipmentId" : "55800"', '"productId" : "DEMO_1_1"', '"orderId" : "55800"', '"orderItemSeqId" : "01"',
                '"invoiceId" : "55800"'] },
        { requestMethod: "get", screenPath: "s1/mantle/orders/55800/items/01/issuances", parameters: null, containsTextList: ['"assetIssuanceId" : "55800"', '"orderId" : "55800"',
                '"orderItemSeqId" : "01"', '"shipmentId" : "55800"'] },
    ],
    expect({ requestMethod, screenPath, parameters, containsTextList }) {
        const str = restTest.render(screenPath, parameters, requestMethod)
        let containsAll = true
        for (const containsText of containsTextList) {
            const contains = containsText ? str.assertContains(containsText) : true
            if (!contains) {
                log.info(`In ${screenPath} text [${containsText}] not found:\n${str.output}`)
                containsAll = false
            }
        }

        // assertions
        !str.errorMessages
        containsAll
    },
})
