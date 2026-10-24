// Port of OrderToCashBasicFlow.groovy: sales order, reservation, shipment, invoice and payment, business customer order,
// credit memo, overpayment and refund, inventory reservation/issuance tests with cancelled shipments, displace reservation.
const effectiveTime = Date.now()
let cartOrderId = null, cartOrderPartSeqId
let inventoryOrderId = null
let setInfoOut, shipResult
let b2bPaymentId, b2bShipmentId, b2bCredMemoId
// checkData returns only the error messages, not a count of fields checked, so there is no totalFieldsChecked total

spec({
    dependsOn: ["OrderProcureToPayBasicFlow"],
    tempSequences: { start: 55500, banks: {
        "mantle.account.method.PaymentGatewayResponse": 10, "mantle.ledger.transaction.AcctgTrans": 50,
        "mantle.shipment.Shipment": 10, "mantle.shipment.ShipmentItemSource": 10,
        "mantle.product.asset.Asset": 10, "mantle.product.asset.AssetDetail": 50, "mantle.product.asset.PhysicalInventory": 10,
        "mantle.product.issuance.AssetReservation": 10, "mantle.product.issuance.AssetIssuance": 10,
        "mantle.account.invoice.Invoice": 10, "mantle.account.payment.Payment": 10, "mantle.account.payment.PaymentApplication": 10,
        "mantle.order.OrderHeader": 10, "mantle.order.OrderItemBilling": 20 } },
    setupSpec() {
        // set an effective date so data check works, etc
        ec.user.setEffectiveTime(effectiveTime)
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

function check(xml) {
    const dataCheckErrors = checkData(xml)
    for (const e of dataCheckErrors) log.info(e)
    if (ec.message.hasError()) log.warn(ec.message.getErrorsString())
    return dataCheckErrors
}

// check QOH - ATP = Reservations
function assetTotals() {
    const assetDetailSummaryList = ec.entity.find("mantle.product.asset.AssetDetailSummary")
            .condition("assetId", "DEMO_UNITA").selectField("availableToPromiseTotal,quantityOnHandTotal").list()
    const availableToPromiseTotal = assetDetailSummaryList[0].availableToPromiseTotal
    const quantityOnHandTotal = assetDetailSummaryList[0].quantityOnHandTotal
    const reservationTotal = sum(ec.entity.find("mantle.product.issuance.AssetReservation")
            .condition("assetId", "DEMO_UNITA").list(), "quantity")
    log.info("availableToPromiseTotal " + String(availableToPromiseTotal) + " quantityOnHandTotal " + String(quantityOnHandTotal) +
        " reservationTotal " + String(reservationTotal))
    return { availableToPromiseTotal, quantityOnHandTotal, reservationTotal }
}

feature("create Sales Order", {
    when() {
        login("joe@public.com")

        const productStoreId = "POPC_DEFAULT"
        const productStore = ec.entity.find("mantle.product.store.ProductStore").condition("productStoreId", productStoreId).one()
        const currencyUomId = productStore.defaultCurrencyUomId
        const priceUomId = productStore.defaultCurrencyUomId
        const vendorPartyId = productStore.organizationPartyId
        const customerPartyId = ec.user.userAccount.partyId

        const priceMap = call("mantle.product.PriceServices.get#ProductPrice",
                { productId: "DEMO_1_1", priceUomId, productStoreId, vendorPartyId, customerPartyId })

        const addOut1 = call("mantle.order.OrderServices.add#OrderProductQuantity",
                { productId: "DEMO_1_1", quantity: 1, customerPartyId, currencyUomId, productStoreId })

        cartOrderId = addOut1.orderId
        cartOrderPartSeqId = addOut1.orderPartSeqId

        // disable tax and shipping calc so existing items don't get removed on recalc for order change
        call("mantle.order.OrderServices.update#OrderPart",
                { orderId: cartOrderId, orderPartSeqId: cartOrderPartSeqId, disablePromotions: "Y", disableShippingCalc: "Y", disableTaxCalc: "Y" })

        // without orderPartSeqId
        const addOut2 = call("mantle.order.OrderServices.add#OrderProductQuantity",
                { orderId: cartOrderId, productId: "DEMO_3_1", quantity: 5 })
        // with orderPartSeqId
        const addOut3 = call("mantle.order.OrderServices.add#OrderProductQuantity",
                { orderId: cartOrderId, orderPartSeqId: cartOrderPartSeqId, productId: "DEMO_2_1", quantity: 7, requireInventory: false })

        // add discount and tax child items
        // item 1 sales tax
        call("mantle.order.OrderServices.create#OrderItem",
                { orderId: cartOrderId, orderPartSeqId: cartOrderPartSeqId, parentItemSeqId: addOut1.orderItemSeqId,
                    itemTypeEnumId: "ItemSalesTax", itemDescription: "Test Tax 7%", quantity: 1, unitAmount: 1.189 }) // 16.99 * 0.07 = 1.1893
        // item 2 discount and sales tax, child qty == parent qty
        call("mantle.order.OrderServices.create#OrderItem",
                { orderId: cartOrderId, orderPartSeqId: cartOrderPartSeqId, parentItemSeqId: addOut2.orderItemSeqId,
                    itemTypeEnumId: "ItemDiscount", itemDescription: "Discount why? Because we love you.", quantity: 5, unitAmount: -1.23 })
        call("mantle.order.OrderServices.create#OrderItem",
                { orderId: cartOrderId, orderPartSeqId: cartOrderPartSeqId, parentItemSeqId: addOut2.orderItemSeqId,
                    itemTypeEnumId: "ItemSalesTax", itemDescription: "Test Tax 7%", quantity: 5, unitAmount: 0.458 }) // (7.77 - 1.23) * 0.07 = 0.4578
        // item 3 discount and sales tax, child qty != parent qty; sales tax with qty = 1 to simulate partial data coming from external system
        call("mantle.order.OrderServices.create#OrderItem",
                { orderId: cartOrderId, orderPartSeqId: cartOrderPartSeqId, parentItemSeqId: addOut3.orderItemSeqId,
                    itemTypeEnumId: "ItemDiscount", itemDescription: "Discount why? Because we love you.", quantity: 4, unitAmount: -2.345 })
        call("mantle.order.OrderServices.create#OrderItem",
                { orderId: cartOrderId, orderPartSeqId: cartOrderPartSeqId, parentItemSeqId: addOut3.orderItemSeqId,
                    itemTypeEnumId: "ItemSalesTax", itemDescription: "Test Tax 7%", quantity: 1, unitAmount: 5.28 }) // ((12.12 * 7) - (2.345 * 4)) * 0.07 = 5.2822

        // a pick assembly product
        const addOut4 = call("mantle.order.OrderServices.add#OrderProductQuantity",
                { orderId: cartOrderId, orderPartSeqId: cartOrderPartSeqId, productId: "DEMO_PA", quantity: 2, unitAmount: 30.0, requireInventory: false })

        // add shipping charges, order part level not per item
        call("mantle.order.OrderServices.create#OrderItem",
                { orderId: cartOrderId, orderPartSeqId: cartOrderPartSeqId,
                    itemTypeEnumId: "ItemShipping", itemDescription: "Standard Shipping", quantity: 1, unitAmount: 6.77 })

        setInfoOut = call("mantle.order.OrderServices.set#OrderBillingShippingInfo",
                { orderId: cartOrderId, paymentMethodId: "CustJqpCc", shippingPostalContactMechId: "CustJqpAddr",
                    shippingTelecomContactMechId: "CustJqpTeln", carrierPartyId: "_NA_", shipmentMethodEnumId: "ShMthGround" })
        // place order
        call("mantle.order.OrderServices.place#Order", { orderId: cartOrderId, requireInventory: false })

        logout()

        // explicitly approve order as john.doe (has pre-approve warnings for unavailable inventory so must be done explicitly)
        login("john.doe")
        call("mantle.order.OrderServices.approve#Order", { orderId: cartOrderId })
        logout()

        // NOTE: this has sequenced IDs so is sensitive to run order!
        const dataCheckErrors = check(`<entity-facade-xml>
            <mantle.order.OrderHeader orderId="${cartOrderId}" entryDate="${effectiveTime}" placedDate="${effectiveTime}"
                statusId="OrderApproved" currencyUomId="USD" productStoreId="POPC_DEFAULT" grandTotal="200.68"/>

            <mantle.account.payment.Payment paymentId="${setInfoOut.paymentId}" paymentTypeEnumId="PtInvoicePayment"
                paymentMethodId="CustJqpCc" paymentInstrumentEnumId="PiCreditCard" orderId="${cartOrderId}"
                orderPartSeqId="01" statusId="PmntAuthorized" amount="200.68"
                amountUomId="USD" fromPartyId="CustJqp" toPartyId="ORG_ZIZI_RETAIL"/>
            <mantle.account.method.PaymentGatewayResponse paymentGatewayResponseId="55500"
                paymentOperationEnumId="PgoAuthorize"
                paymentId="${setInfoOut.paymentId}" paymentMethodId="CustJqpCc" amount="200.68"
                amountUomId="USD" transactionDate="${effectiveTime}" resultSuccess="Y" resultDeclined="N" resultNsf="N"
                resultBadExpire="N" resultBadCardNumber="N"/>
            <!-- don't validate these, allow any payment gateway: paymentGatewayConfigId="TEST_APPROVE" referenceNum="TEST" -->

            <mantle.order.OrderPart orderId="${cartOrderId}" orderPartSeqId="01" vendorPartyId="ORG_ZIZI_RETAIL"
                customerPartyId="CustJqp" shipmentMethodEnumId="ShMthGround" postalContactMechId="CustJqpAddr"
                telecomContactMechId="CustJqpTeln" partTotal="200.68"/>
            <mantle.order.OrderItem orderId="${cartOrderId}" orderItemSeqId="01" orderPartSeqId="01" itemTypeEnumId="ItemProduct"
                productId="DEMO_1_1" itemDescription="Demo Product One-One" quantity="1" unitAmount="16.99"
                unitListPrice="19.99" isModifiedPrice="N"/>
            <mantle.order.OrderItem orderId="${cartOrderId}" orderItemSeqId="02" orderPartSeqId="01" itemTypeEnumId="ItemProduct"
                productId="DEMO_3_1" itemDescription="Demo Product Three-One" quantity="5" unitAmount="7.77"
                unitListPrice="" isModifiedPrice="N"/>
            <mantle.order.OrderItem orderId="${cartOrderId}" orderItemSeqId="03" orderPartSeqId="01" itemTypeEnumId="ItemProduct"
                productId="DEMO_2_1" itemDescription="Demo Product Two-One" quantity="7" unitAmount="12.12"
                unitListPrice="" isModifiedPrice="N"/>

            <!-- TODO PtPickAssembly add OrderItem for DEMO_PA -->

        </entity-facade-xml>`)
        log.info("create Sales Order data check results: " + dataCheckErrors)
        return { priceMap, vendorPartyId, customerPartyId, dataCheckErrors }
    },
    then({ priceMap, vendorPartyId, customerPartyId, dataCheckErrors }) {
        priceMap.price == 16.99
        priceMap.priceUomId == "USD"
        vendorPartyId == "ORG_ZIZI_RETAIL"
        customerPartyId == "CustJqp"

        dataCheckErrors.length == 0
    },
})

feature("validate Asset Reservation", {
    when() {
        // NOTE: this has sequenced IDs so is sensitive to run order!
        return { dataCheckErrors: check(`<entity-facade-xml>
            <!-- Asset created, issued, changed record in detail -->

            <mantle.product.asset.Asset assetId="55400" acquireCost="8" acquireCostUomId="USD" productId="DEMO_1_1"
                statusId="AstAvailable" assetTypeEnumId="AstTpInventory" originalQuantity="400" quantityOnHandTotal="400"
                availableToPromiseTotal="187" facilityId="ZIRET_WH" ownerPartyId="ORG_ZIZI_RETAIL"
                hasQuantity="Y" assetName="Demo Product One-One"/>
            <mantle.product.issuance.AssetReservation assetReservationId="55500" assetId="55400" orderId="${cartOrderId}"
                orderItemSeqId="01" reservedDate="${effectiveTime}" quantity="1" productId="DEMO_1_1" sequenceNum="0"
                quantityNotIssued="1" quantityNotAvailable="0" reservationOrderEnumId="AsResOrdFifoRec"/>
            <mantle.product.asset.AssetDetail assetDetailId="55500" assetId="55400" productId="DEMO_1_1"
                assetReservationId="55500" availableToPromiseDiff="-1" effectiveDate="${effectiveTime}"/>

            <!-- this is an auto-created Asset based on the inventory issuance -->
            <mantle.product.asset.Asset assetId="55500" assetTypeEnumId="AstTpInventory" statusId="AstAvailable"
                ownerPartyId="ORG_ZIZI_RETAIL" productId="DEMO_2_1" hasQuantity="Y" quantityOnHandTotal="0"
                availableToPromiseTotal="-11" receivedDate="${effectiveTime}" facilityId="ZIRET_WH"/>
            <mantle.product.issuance.AssetReservation assetReservationId="55501" assetId="55500" productId="DEMO_2_1"
                orderId="${cartOrderId}" orderItemSeqId="03" reservationOrderEnumId="AsResOrdFifoRec"
                quantity="7" quantityNotAvailable="7" reservedDate="${effectiveTime}"/>
            <mantle.product.asset.AssetDetail assetDetailId="55501" assetId="55500" effectiveDate="${effectiveTime}"
                availableToPromiseDiff="-7" assetReservationId="55501" productId="DEMO_2_1"/>

            <!-- NOTE: before reserve against pick locations first used assetId DEMO_3_1A instead of 55401 -->
            <mantle.product.asset.Asset assetId="DEMO_3_1A" assetTypeEnumId="AstTpInventory" statusId="AstAvailable"
                ownerPartyId="ORG_ZIZI_RETAIL" productId="DEMO_3_1" hasQuantity="Y" quantityOnHandTotal="5"
                availableToPromiseTotal="0" receivedDate="1265184000000" facilityId="ZIRET_WH"/>
            <mantle.product.asset.Asset assetId="55401" assetTypeEnumId="AstTpInventory" statusId="AstAvailable"
                ownerPartyId="ORG_ZIZI_RETAIL" productId="DEMO_3_1" hasQuantity="Y" quantityOnHandTotal="100"
                availableToPromiseTotal="100" facilityId="ZIRET_WH"/>
            <mantle.product.issuance.AssetReservation assetReservationId="55502" assetId="DEMO_3_1A" productId="DEMO_3_1"
                orderId="${cartOrderId}" orderItemSeqId="02" reservationOrderEnumId="AsResOrdFifoRec" quantity="5"
                reservedDate="${effectiveTime}" sequenceNum="0"/>
            <mantle.product.asset.AssetDetail assetDetailId="55502" assetId="DEMO_3_1A" effectiveDate="${effectiveTime}"
                availableToPromiseDiff="-5" assetReservationId="55502" productId="DEMO_3_1"/>

            <!-- TODO PtPickAssembly AssetReservation records for assembly component products -->

        </entity-facade-xml>`) }
    },
    then({ dataCheckErrors }) {
        dataCheckErrors.length == 0
    },
})

feature("ship Sales Order", {
    when() {
        login("john.doe")

        /* old approach, simple ship entire OrderPart:
        shipResult = call("mantle.shipment.ShipmentServices.ship#OrderPart",
                { orderId: cartOrderId, orderPartSeqId: cartOrderPartSeqId, tryAutoPackage: false })
        */

        shipResult = call("mantle.shipment.ShipmentServices.create#OrderPartShipment",
                { orderId: cartOrderId, orderPartSeqId: cartOrderPartSeqId, createPackage: true })
        const shipmentId = shipResult.shipmentId, shipmentPackageSeqId = shipResult.shipmentPackageSeqId

        call("mantle.shipment.ShipmentServices.pack#ShipmentProduct",
                { productId: "DEMO_1_1", quantity: 1, shipmentId, shipmentPackageSeqId })
        // partial fill, 4 of 5
        call("mantle.shipment.ShipmentServices.pack#ShipmentProduct",
                { productId: "DEMO_3_1", quantity: 4, shipmentId, shipmentPackageSeqId })
        // partial fill, 5 of 7
        call("mantle.shipment.ShipmentServices.pack#ShipmentProduct",
                { productId: "DEMO_2_1", quantity: 5, shipmentId, shipmentPackageSeqId })

        // pack DEMO_PA by component using pack#ShipmentAssemblyComponent
        // pack DEMO_1_1 twice with qty 1 to test AssetIssuance consolidation
        call("mantle.shipment.ShipmentServices.pack#ShipmentAssemblyComponent",
                { productId: "DEMO_1_1", assemblyProductId: "DEMO_PA", quantity: 1, shipmentId, shipmentPackageSeqId })
        call("mantle.shipment.ShipmentServices.pack#ShipmentAssemblyComponent",
                { productId: "DEMO_1_1", assemblyProductId: "DEMO_PA", quantity: 1, shipmentId, shipmentPackageSeqId })
        // pack DEMO_2_1 twice with qty 2 to test produce and issue to shipment one assembly qty at a time
        call("mantle.shipment.ShipmentServices.pack#ShipmentAssemblyComponent",
                { productId: "DEMO_2_1", assemblyProductId: "DEMO_PA", quantity: 2, shipmentId, shipmentPackageSeqId })
        call("mantle.shipment.ShipmentServices.pack#ShipmentAssemblyComponent",
                { productId: "DEMO_2_1", assemblyProductId: "DEMO_PA", quantity: 2, shipmentId, shipmentPackageSeqId })

        call("mantle.shipment.ShipmentServices.pack#Shipment", { shipmentId })
        call("mantle.shipment.ShipmentServices.ship#Shipment", { shipmentId })

        // NOTE: this has sequenced IDs so is sensitive to run order!
        return { dataCheckErrors: check(`<entity-facade-xml>
            <!-- Shipment created -->
            <mantle.shipment.Shipment shipmentId="${shipResult.shipmentId}" shipmentTypeEnumId="ShpTpSales"
                statusId="ShipShipped" fromPartyId="ORG_ZIZI_RETAIL" toPartyId="CustJqp"/>
            <mantle.shipment.ShipmentPackage shipmentId="${shipResult.shipmentId}" shipmentPackageSeqId="01"/>

            <mantle.shipment.ShipmentItem shipmentId="${shipResult.shipmentId}" productId="DEMO_1_1" quantity="1"/>
            <mantle.shipment.ShipmentItemSource shipmentItemSourceId="55500" shipmentId="${shipResult.shipmentId}"
                productId="DEMO_1_1" orderId="${cartOrderId}" orderItemSeqId="01" statusId="SisPacked" quantity="1" quantityNotHandled="0"
                invoiceId="55500" invoiceItemSeqId="01"/>
            <mantle.shipment.ShipmentPackageContent shipmentId="${shipResult.shipmentId}" shipmentPackageSeqId="01"
                productId="DEMO_1_1" quantity="1"/>

            <mantle.shipment.ShipmentItem shipmentId="${shipResult.shipmentId}" productId="DEMO_3_1" quantity="4"/>
            <mantle.shipment.ShipmentItemSource shipmentItemSourceId="55501" shipmentId="${shipResult.shipmentId}"
                productId="DEMO_3_1" orderId="${cartOrderId}" orderItemSeqId="02" statusId="SisPacked" quantity="4" quantityNotHandled="0"
                invoiceId="55500" invoiceItemSeqId="03"/>
            <mantle.shipment.ShipmentPackageContent shipmentId="${shipResult.shipmentId}" shipmentPackageSeqId="01"
                productId="DEMO_3_1" quantity="4"/>

            <mantle.shipment.ShipmentItem shipmentId="${shipResult.shipmentId}" productId="DEMO_2_1" quantity="5"/>
            <mantle.shipment.ShipmentItemSource shipmentItemSourceId="55502" shipmentId="${shipResult.shipmentId}"
                productId="DEMO_2_1" orderId="${cartOrderId}" orderItemSeqId="03" statusId="SisPacked" quantity="5" quantityNotHandled="0"
                invoiceId="55500" invoiceItemSeqId="06"/>
            <mantle.shipment.ShipmentPackageContent shipmentId="${shipResult.shipmentId}" shipmentPackageSeqId="01"
                productId="DEMO_2_1" quantity="5"/>

            <!-- TODO PtPickAssembly ShipmentItem and Source for DEMO_PA -->

            <mantle.shipment.ShipmentRouteSegment shipmentId="${shipResult.shipmentId}" shipmentRouteSegmentSeqId="01"
                destPostalContactMechId="CustJqpAddr" destTelecomContactMechId="CustJqpTeln"/>
            <mantle.shipment.ShipmentPackageRouteSeg shipmentId="${shipResult.shipmentId}" shipmentPackageSeqId="01"
                shipmentRouteSegmentSeqId="01"/>
        </entity-facade-xml>`) }
    },
    then({ dataCheckErrors }) {
        dataCheckErrors.length == 0
    },
})

feature("close Partial Filled Order", {
    when() {
        call("mantle.order.OrderServices.cancel#Order", { orderId: cartOrderId })

        const dataCheckErrors = check(`<entity-facade-xml>
            <!-- OrderHeader status to Completed -->
            <mantle.order.OrderHeader orderId="${cartOrderId}" entryDate="${effectiveTime}" placedDate="${effectiveTime}"
                statusId="OrderCompleted" currencyUomId="USD" productStoreId="POPC_DEFAULT" grandTotal="170.61"/>
        </entity-facade-xml>`)
        return { dataCheckErrors }
    },
    then({ dataCheckErrors }) {
        dataCheckErrors.length == 0
    },
})

feature("validate Asset Issuance", {
    when() {
        // NOTE: this has sequenced IDs so is sensitive to run order!
        return { dataCheckErrors: check(`<entity-facade-xml>
            <!-- Asset created, issued, change recorded in detail -->

            <mantle.product.asset.Asset assetId="55400" quantityOnHandTotal="397" availableToPromiseTotal="187"/>
            <mantle.product.issuance.AssetIssuance assetIssuanceId="55500" assetId="55400" orderId="${cartOrderId}"
                orderItemSeqId="01" issuedDate="${effectiveTime}" quantity="1" productId="DEMO_1_1"
                assetReservationId="55500" shipmentId="${shipResult.shipmentId}"/>
            <mantle.product.asset.AssetDetail assetDetailId="55505" assetId="55400" effectiveDate="${effectiveTime}"
                quantityOnHandDiff="-1" assetReservationId="55500" shipmentId="${shipResult.shipmentId}"
                productId="DEMO_1_1" assetIssuanceId="55500"/>

            <mantle.product.asset.Asset assetId="DEMO_3_1A" quantityOnHandTotal="1" availableToPromiseTotal="1"/>
            <mantle.product.asset.Asset assetId="55401" quantityOnHandTotal="100" availableToPromiseTotal="100"/>
            <mantle.product.issuance.AssetIssuance assetIssuanceId="55501" assetId="DEMO_3_1A" assetReservationId="55502"
                orderId="${cartOrderId}" orderItemSeqId="02" shipmentId="${shipResult.shipmentId}" productId="DEMO_3_1"
                quantity="4"/>
            <mantle.product.asset.AssetDetail assetDetailId="55506" assetId="DEMO_3_1A" effectiveDate="${effectiveTime}"
                quantityOnHandDiff="-4" assetReservationId="55502" shipmentId="${shipResult.shipmentId}"
                productId="DEMO_3_1" assetIssuanceId="55501"/>

            <!-- this is an auto-created Asset based on the inventory issuance -->
            <mantle.product.asset.Asset assetId="55500" quantityOnHandTotal="0" availableToPromiseTotal="0"/>
            <mantle.product.issuance.AssetIssuance assetIssuanceId="55502" assetId="55500" assetReservationId="55501"
                orderId="${cartOrderId}" orderItemSeqId="03" shipmentId="${shipResult.shipmentId}" productId="DEMO_2_1"
                quantity="5"/>
            <mantle.product.asset.AssetDetail assetDetailId="55507" assetId="55500" effectiveDate="${effectiveTime}"
                quantityOnHandDiff="-5" assetReservationId="55501" shipmentId="${shipResult.shipmentId}"
                productId="DEMO_2_1" assetIssuanceId="55502"/>
            <!-- the automatic physical inventory found record because QOH went below zero -->
            <mantle.product.asset.AssetDetail assetDetailId="55508" assetId="55500" physicalInventoryId="55500"
                availableToPromiseDiff="5" quantityOnHandDiff="5" productId="DEMO_2_1" varianceReasonEnumId="InVrFound"
                acctgTransResultEnumId="AtrNoAcquireCost"/>
        </entity-facade-xml>`) }
    },
    then({ dataCheckErrors }) {
        dataCheckErrors.length == 0
    },
})

feature("validate Asset Issuance Accounting Transactions", {
    when() {
        // NOTE: this has sequenced IDs so is sensitive to run order!
        return { dataCheckErrors: check(`<entity-facade-xml>
            <mantle.ledger.transaction.AcctgTrans acctgTransId="55500" acctgTransTypeEnumId="AttInventoryIssuance"
                organizationPartyId="ORG_ZIZI_RETAIL" transactionDate="${effectiveTime}" isPosted="Y"
                postedDate="${effectiveTime}" glFiscalTypeEnumId="GLFT_ACTUAL" amountUomId="USD" assetId="55400"
                assetIssuanceId="55500"/>
            <mantle.ledger.transaction.AcctgTransEntry acctgTransId="55500" acctgTransEntrySeqId="01" debitCreditFlag="C"
                amount="8" glAccountTypeEnumId="GatInventory" glAccountId="141300000"
                reconcileStatusId="AterNot" isSummary="N" productId="DEMO_1_1"/>
            <mantle.ledger.transaction.AcctgTransEntry acctgTransId="55500" acctgTransEntrySeqId="02" debitCreditFlag="D"
                amount="8" glAccountTypeEnumId="GatCogs" glAccountId="512000000"
                reconcileStatusId="AterNot" isSummary="N" productId="DEMO_1_1"/>

            <mantle.ledger.transaction.AcctgTrans acctgTransId="55501" acctgTransTypeEnumId="AttInventoryIssuance"
                organizationPartyId="ORG_ZIZI_RETAIL" transactionDate="${effectiveTime}" isPosted="Y"
                postedDate="${effectiveTime}" glFiscalTypeEnumId="GLFT_ACTUAL" amountUomId="USD" assetId="DEMO_3_1A"
                assetIssuanceId="55501"/>
            <mantle.ledger.transaction.AcctgTransEntry acctgTransId="55501" acctgTransEntrySeqId="01" debitCreditFlag="C"
                amount="16" glAccountTypeEnumId="GatInventory" glAccountId="141300000"
                reconcileStatusId="AterNot" isSummary="N" productId="DEMO_3_1"/>
            <mantle.ledger.transaction.AcctgTransEntry acctgTransId="55501" acctgTransEntrySeqId="02" debitCreditFlag="D"
                amount="16" glAccountTypeEnumId="GatCogs" glAccountId="512000000"
                reconcileStatusId="AterNot" isSummary="N" productId="DEMO_3_1"/>

            <!-- NOTE: there is no AcctgTrans for assetId 55500, productId DEMO_2_1 because it is auto-created and has
                no acquireCost. -->
        </entity-facade-xml>`) }
    },
    then({ dataCheckErrors }) {
        dataCheckErrors.length == 0
    },
})

feature("validate Shipment Invoice", {
    when() {
        // NOTE: this has sequenced IDs so is sensitive to run order!
        return { dataCheckErrors: check(`<entity-facade-xml>
            <!-- Invoice created and Finalized (status set by action in SECA rule), then Payment Received (status set by Payment application) -->

            <invoices invoiceId="55500" invoiceTypeEnumId="InvoiceSales" statusId="InvoicePmtRecvd" toPartyId="CustJqp" fromPartyId="ORG_ZIZI_RETAIL" 
                    description="For Order ${cartOrderId} part 01 and Shipment ${shipResult.shipmentId}" productStoreId="POPC_DEFAULT" 
                    settlementTermId="Net30" acctgTransResultEnumId="AtrSuccess" invoiceDate="${effectiveTime}" 
                    currencyUomId="USD" invoiceTotal="170.61" unpaidTotal="0" appliedPaymentsTotal="170.61">
                <paymentApplications amountApplied="170.61" appliedDate="${effectiveTime}" acctgTransResultEnumId="AtrSuccess" paymentApplicationId="55500" paymentId="55500"/>

                <items invoiceItemSeqId="01" amount="16.99" quantity="1" productId="DEMO_1_1" description="Demo Product One-One" itemTypeEnumId="ItemProduct" assetId="55400">
                    <orderItemBillings orderItemSeqId="01" amount="16.99" quantity="1" orderId="${cartOrderId}" shipmentId="${shipResult.shipmentId}" assetIssuanceId="55500" orderItemBillingId="55500"/>
                    <issuances assetIssuanceId="55500" orderItemSeqId="01" issuedDate="${effectiveTime}" shipmentItemSourceId="55500" 
                        issuedByUserId="EX_JOHN_DOE" quantity="1" productId="DEMO_1_1" orderId="${cartOrderId}" assetReservationId="55500" 
                        acctgTransResultEnumId="AtrSuccess" assetId="55400" shipmentId="${shipResult.shipmentId}"/>
                    <shipmentItemSources shipmentItemSourceId="55500" orderId="${cartOrderId}" orderItemSeqId="01" quantity="1" 
                        productId="DEMO_1_1" statusId="SisPacked" quantityNotHandled="0" shipmentId="${shipResult.shipmentId}"/>
                </items>
                <items invoiceItemSeqId="02" parentItemSeqId="01" amount="1.189" quantity="1" description="Test Tax 7%" itemTypeEnumId="ItemSalesTax">
                    <orderItemBillings orderItemSeqId="04" amount="1.189" quantity="1" orderId="${cartOrderId}" shipmentId="${shipResult.shipmentId}" orderItemBillingId="55501"/>
                </items>
                <items invoiceItemSeqId="03" amount="7.77" quantity="4" productId="DEMO_3_1" description="Demo Product Three-One" itemTypeEnumId="ItemProduct" assetId="DEMO_3_1A">
                    <orderItemBillings orderItemSeqId="02" amount="7.77" quantity="4" orderId="${cartOrderId}" shipmentId="${shipResult.shipmentId}" assetIssuanceId="55501" orderItemBillingId="55502"/>
                    <issuances assetIssuanceId="55501" issuedDate="${effectiveTime}" shipmentItemSourceId="55501" issuedByUserId="EX_JOHN_DOE" 
                        quantity="4" productId="DEMO_3_1" orderId="${cartOrderId}" orderItemSeqId="02" assetReservationId="55502" 
                        acctgTransResultEnumId="AtrSuccess" assetId="DEMO_3_1A" shipmentId="${shipResult.shipmentId}"/>
                    <shipmentItemSources shipmentItemSourceId="55501" orderId="${cartOrderId}" orderItemSeqId="02" quantity="4" 
                        productId="DEMO_3_1" statusId="SisPacked" quantityNotHandled="0" shipmentId="${shipResult.shipmentId}"/>
                </items>
                <items invoiceItemSeqId="04" parentItemSeqId="03" amount="-1.23" quantity="4" description="Discount why? Because we love you." itemTypeEnumId="ItemDiscount">
                    <orderItemBillings orderItemSeqId="05" amount="-1.23" quantity="4" orderId="${cartOrderId}" shipmentId="${shipResult.shipmentId}" orderItemBillingId="55503"/>
                </items>
                <items invoiceItemSeqId="05" parentItemSeqId="03" amount="0.458" quantity="4" description="Test Tax 7%" itemTypeEnumId="ItemSalesTax">
                    <orderItemBillings orderItemSeqId="06" amount="0.458" quantity="4" orderId="${cartOrderId}" shipmentId="${shipResult.shipmentId}" orderItemBillingId="55504"/>
                </items>
                <items invoiceItemSeqId="06" amount="12.12" quantity="5" productId="DEMO_2_1" description="Demo Product Two-One" itemTypeEnumId="ItemProduct" assetId="55500">
                    <orderItemBillings orderItemSeqId="03" amount="12.12" quantity="5" orderId="${cartOrderId}" shipmentId="${shipResult.shipmentId}" assetIssuanceId="55502" orderItemBillingId="55505"/>
                    <issuances assetIssuanceId="55502" assetId="55500" issuedDate="${effectiveTime}" shipmentItemSourceId="55502" issuedByUserId="EX_JOHN_DOE" 
                        quantity="5" productId="DEMO_2_1" orderId="${cartOrderId}" orderItemSeqId="03" assetReservationId="55501" 
                        acctgTransResultEnumId="AtrNoAcquireCost" shipmentId="${shipResult.shipmentId}"/>
                    <shipmentItemSources shipmentItemSourceId="55502" quantity="5" orderId="${cartOrderId}" orderItemSeqId="03" 
                        productId="DEMO_2_1" statusId="SisPacked" quantityNotHandled="0" shipmentId="${shipResult.shipmentId}"/>
                </items>
                <items amount="-6.7" quantity="1" description="Discount why? Because we love you." invoiceItemSeqId="07" itemTypeEnumId="ItemDiscount" parentItemSeqId="06">
                    <orderItemBillings orderItemSeqId="07" amount="-6.7" quantity="1" orderId="${cartOrderId}" shipmentId="${shipResult.shipmentId}" orderItemBillingId="55506"/>
                </items>
                <items amount="3.77" quantity="1" description="Test Tax 7%" invoiceItemSeqId="08" itemTypeEnumId="ItemSalesTax" parentItemSeqId="06">
                    <orderItemBillings orderItemSeqId="08" amount="3.77" quantity="1" orderId="${cartOrderId}" shipmentId="${shipResult.shipmentId}" orderItemBillingId="55507"/>
                </items>
                <!-- TODO PtPickAssembly invoiceItemSeqId="09" -->
                <items amount="6.77" quantity="1" description="Standard Shipping" invoiceItemSeqId="10" itemTypeEnumId="ItemShipping">
                    <orderItemBillings orderItemSeqId="10" amount="6.77" quantity="1" orderId="${cartOrderId}" shipmentId="${shipResult.shipmentId}" orderItemBillingId="55509"/>
                </items>
                <status lastUpdatedStamp="1547839589298" statusId="InvoicePmtRecvd" sequenceNum="5" statusTypeId="Invoice" description="Payment Received"/>
            </invoices>
        </entity-facade-xml>`) }
    },
    then({ dataCheckErrors }) {
        dataCheckErrors.length == 0
    },
})

feature("validate Shipment Invoice Accounting Transaction", {
    when() {
        // NOTE: this has sequenced IDs so is sensitive to run order!
        return { dataCheckErrors: check(`<entity-facade-xml>
            <!-- AcctgTrans created for Finalized Invoice -->
            <acctgTrans acctgTransId="55504" invoiceId="55500" organizationPartyId="ORG_ZIZI_RETAIL" otherPartyId="CustJqp" 
                    postedDate="${effectiveTime}" amountUomId="USD" isPosted="Y" acctgTransTypeEnumId="AttSalesInvoice" 
                    glFiscalTypeEnumId="GLFT_ACTUAL" transactionDate="${effectiveTime}">
                <entries acctgTransEntrySeqId="01" amount="16.99" debitCreditFlag="C" glAccountId="411000000" productId="DEMO_1_1" 
                        description="Demo Product One-One" reconcileStatusId="AterNot" invoiceItemSeqId="01" isSummary="N" 
                        glAccountTypeEnumId="GatSales" assetId="55400"/>
                <entries acctgTransEntrySeqId="02" amount="1.19" debitCreditFlag="C" glAccountId="224000000" 
                        description="Test Tax 7%" reconcileStatusId="AterNot" invoiceItemSeqId="02" isSummary="N" 
                        glAccountTypeEnumId="GatAccruedExpenses"/>

                <entries acctgTransEntrySeqId="03" amount="31.08" debitCreditFlag="C" glAccountId="411000000" productId="DEMO_3_1" 
                        description="Demo Product Three-One" reconcileStatusId="AterNot" invoiceItemSeqId="03" isSummary="N" 
                        glAccountTypeEnumId="GatSales" assetId="DEMO_3_1A"/>
                <entries acctgTransEntrySeqId="04" amount="4.92" debitCreditFlag="D" glAccountId="522200000"
                        description="Discount why? Because we love you." reconcileStatusId="AterNot" invoiceItemSeqId="04" isSummary="N" 
                        glAccountTypeEnumId="GatDiscounts"/>
                <entries acctgTransEntrySeqId="05" amount="1.83" debitCreditFlag="C" glAccountId="224000000" 
                        description="Test Tax 7%" reconcileStatusId="AterNot" invoiceItemSeqId="05" isSummary="N" glAccountTypeEnumId="GatAccruedExpenses"/>

                <entries acctgTransEntrySeqId="06" amount="60.6" debitCreditFlag="C" glAccountId="411000000" productId="DEMO_2_1" 
                        description="Demo Product Two-One" reconcileStatusId="AterNot" invoiceItemSeqId="06" isSummary="N" 
                        glAccountTypeEnumId="GatSales" assetId="55500"/>
                <entries acctgTransEntrySeqId="07" amount="6.7" debitCreditFlag="D" glAccountId="522200000"
                        description="Discount why? Because we love you." reconcileStatusId="AterNot" invoiceItemSeqId="07" isSummary="N" 
                        glAccountTypeEnumId="GatDiscounts"/>
                <entries acctgTransEntrySeqId="08" amount="3.77" debitCreditFlag="C" glAccountId="224000000" 
                        description="Test Tax 7%" reconcileStatusId="AterNot" invoiceItemSeqId="08" isSummary="N" 
                        glAccountTypeEnumId="GatAccruedExpenses"/>
                <!-- TODO PtPickAssembly acctgTransEntrySeqId="09" -->
                <entries acctgTransEntrySeqId="10" amount="6.77" debitCreditFlag="C" glAccountId="441000000" 
                        description="Standard Shipping" reconcileStatusId="AterNot" invoiceItemSeqId="10" isSummary="N"/>
                <entries acctgTransEntrySeqId="11" amount="170.61" debitCreditFlag="D" glAccountId="121000000" 
                        reconcileStatusId="AterNot" isSummary="N" glAccountTypeEnumId="GatAccountsReceivable"/>
            </acctgTrans>
        </entity-facade-xml>`) }
    },
    then({ dataCheckErrors }) {
        dataCheckErrors.length == 0
    },
})

feature("validate Payment Accounting Transaction", {
    when() {
        // NOTE: this has sequenced IDs so is sensitive to run order!
        return { dataCheckErrors: check(`<entity-facade-xml>
            <mantle.account.payment.Payment paymentId="${setInfoOut.paymentId}" statusId="PmntDelivered"/>
            <mantle.account.payment.PaymentApplication paymentApplicationId="55500" paymentId="${setInfoOut.paymentId}"
                invoiceId="55500" amountApplied="170.61" appliedDate="${effectiveTime}"/>
            <mantle.account.method.PaymentGatewayResponse paymentGatewayResponseId="55501"
                paymentOperationEnumId="PgoCapture"
                paymentId="${setInfoOut.paymentId}" paymentMethodId="CustJqpCc" amount="200.68" amountUomId="USD"
                transactionDate="${effectiveTime}" resultSuccess="Y" resultDeclined="N" resultNsf="N"
                resultBadExpire="N" resultBadCardNumber="N"/>
            <!-- don't validate these, allow any payment gateway: paymentGatewayConfigId="TEST_APPROVE" referenceNum="TEST" -->

            <mantle.ledger.transaction.AcctgTrans acctgTransId="55505" acctgTransTypeEnumId="AttIncomingPayment"
                organizationPartyId="ORG_ZIZI_RETAIL" transactionDate="${effectiveTime}" isPosted="Y"
                glFiscalTypeEnumId="GLFT_ACTUAL" amountUomId="USD" otherPartyId="CustJqp"
                paymentId="${setInfoOut.paymentId}"/>
            <mantle.ledger.transaction.AcctgTransEntry acctgTransId="55505" acctgTransEntrySeqId="01" debitCreditFlag="C"
                amount="200.68" glAccountId="126000000" reconcileStatusId="AterNot" isSummary="N"/>
            <mantle.ledger.transaction.AcctgTransEntry acctgTransId="55505" acctgTransEntrySeqId="02" debitCreditFlag="D"
                amount="200.68" glAccountId="111100000" reconcileStatusId="AterNot" isSummary="N"/>
        </entity-facade-xml>`) }
    },
    then({ dataCheckErrors }) {
        dataCheckErrors.length == 0
    },
})

/* ========== Business Customer Order, Credit Memo, Overpay/Refund, etc ========== */

feature("create and Ship Business Customer Order", {
    when() {
        const createOut = call("mantle.order.OrderServices.create#Order",
                { vendorPartyId: "ORG_ZIZI_RETAIL", customerPartyId: "JoeDist", facilityId: "ZIRET_WH" })

        const b2bOrderId = createOut.orderId
        const b2bOrderPartSeqId = createOut.orderPartSeqId

        call("mantle.order.OrderServices.add#OrderProductQuantity",
                { orderId: b2bOrderId, orderPartSeqId: b2bOrderPartSeqId, productId: "DEMO_1_1", quantity: 100.0, unitAmount: 15.0 })
        call("mantle.order.OrderServices.add#OrderProductQuantity",
                { orderId: b2bOrderId, orderPartSeqId: b2bOrderPartSeqId, productId: "DEMO_3_1", quantity: 20.0, unitAmount: 5.5 })

        call("mantle.order.OrderServices.set#OrderBillingShippingInfo",
                { orderId: b2bOrderId, orderPartSeqId: b2bOrderPartSeqId, shippingPostalContactMechId: "JoeDistAddr",
                    carrierPartyId: "_NA_", shipmentMethodEnumId: "ShMthGround" })
        const b2bPaymentOut = call("mantle.order.OrderServices.add#OrderPartPayment",
                { orderId: b2bOrderId, orderPartSeqId: b2bOrderPartSeqId, paymentInstrumentEnumId: "PiCompanyCheck" })
        b2bPaymentId = b2bPaymentOut.paymentId

        call("mantle.order.OrderServices.place#Order", { orderId: b2bOrderId })
        call("mantle.order.OrderServices.approve#Order", { orderId: b2bOrderId })

        const b2bShipmentOut = call("mantle.shipment.ShipmentServices.create#OrderPartShipment",
                { orderId: b2bOrderId, orderPartSeqId: b2bOrderPartSeqId, createPackage: true })
        b2bShipmentId = b2bShipmentOut.shipmentId
        const b2bShipmentPackageSeqId = b2bShipmentOut.shipmentPackageSeqId

        call("mantle.shipment.ShipmentServices.pack#ShipmentProduct",
                { productId: "DEMO_1_1", quantity: 100, shipmentId: b2bShipmentId, shipmentPackageSeqId: b2bShipmentPackageSeqId })
        call("mantle.shipment.ShipmentServices.pack#ShipmentProduct",
                { productId: "DEMO_3_1", quantity: 20, shipmentId: b2bShipmentId, shipmentPackageSeqId: b2bShipmentPackageSeqId })

        call("mantle.shipment.ShipmentServices.pack#Shipment", { shipmentId: b2bShipmentId })
        call("mantle.shipment.ShipmentServices.ship#Shipment", { shipmentId: b2bShipmentId })

        const dataCheckErrors = check(`<entity-facade-xml>
            <mantle.account.invoice.Invoice invoiceId="55501" invoiceTypeEnumId="InvoiceSales"
                fromPartyId="ORG_ZIZI_RETAIL" toPartyId="JoeDist" statusId="InvoiceFinalized" invoiceDate="${effectiveTime}"
                currencyUomId="USD" invoiceTotal="1610.0" appliedPaymentsTotal="0" unpaidTotal="1610.0"/>
        </entity-facade-xml>`)
        return { dataCheckErrors }
    },
    then({ dataCheckErrors }) {
        dataCheckErrors.length == 0
    },
})

feature("create Customer Credit Memo Invoice", {
    when() {
        const b2bCredMemoOut = call("mantle.account.InvoiceServices.create#Invoice",
                { fromPartyId: "JoeDist", toPartyId: "ORG_ZIZI_RETAIL", invoiceTypeEnumId: "InvoiceCreditMemo", invoiceDate: new Date(effectiveTime) })
        b2bCredMemoId = b2bCredMemoOut.invoiceId
        // add single item for ItemChargebackAdjust
        call("mantle.account.InvoiceServices.create#InvoiceItem", { invoiceId: b2bCredMemoId,
                itemTypeEnumId: "ItemChargebackAdjust", description: "Test Chargeback", quantity: 1.0, amount: 250.0 })
        // approve invoice (posts to GL)
        call("update#mantle.account.invoice.Invoice", { invoiceId: b2bCredMemoId, statusId: "InvoiceApproved" })

        const dataCheckErrors = check(`<entity-facade-xml>
            <mantle.account.invoice.Invoice invoiceId="${b2bCredMemoId}" invoiceTypeEnumId="InvoiceCreditMemo"
                fromPartyId="JoeDist" toPartyId="ORG_ZIZI_RETAIL" statusId="InvoiceApproved" invoiceDate="${effectiveTime}"
                currencyUomId="USD" invoiceTotal="250" appliedPaymentsTotal="0" unpaidTotal="250"/>

            <mantle.ledger.transaction.AcctgTrans acctgTransId="55510" acctgTransTypeEnumId="AttCreditMemo"
                    organizationPartyId="ORG_ZIZI_RETAIL" transactionDate="${effectiveTime}" isPosted="Y"
                    postedDate="${effectiveTime}" glFiscalTypeEnumId="GLFT_ACTUAL" amountUomId="USD"
                    otherPartyId="JoeDist" invoiceId="${b2bCredMemoId}">
                <mantle.ledger.transaction.AcctgTransEntry acctgTransEntrySeqId="01" debitCreditFlag="D"
                        amount="250" glAccountId="522100000" reconcileStatusId="AterNot" isSummary="N"/>
                <mantle.ledger.transaction.AcctgTransEntry acctgTransEntrySeqId="02" debitCreditFlag="C"
                        amount="250" glAccountId="212000000" reconcileStatusId="AterNot" isSummary="N"/>
            </mantle.ledger.transaction.AcctgTrans>
        </entity-facade-xml>`)
        return { dataCheckErrors }
    },
    then({ dataCheckErrors }) {
        dataCheckErrors.length == 0
    },
})

feature("apply Customer Credit Memo Invoice", {
    when() {
        const b2bInvoiceId = "55501"
        const credMemoApplResult = call("mantle.account.PaymentServices.apply#InvoiceToInvoice",
                { invoiceId: b2bCredMemoId, toInvoiceId: b2bInvoiceId })
        const paymentApplicationId = credMemoApplResult.paymentApplicationId

        const dataCheckErrors = check(`<entity-facade-xml>
            <mantle.account.payment.PaymentApplication paymentApplicationId="${paymentApplicationId}"
                invoiceId="${b2bCredMemoId}" toInvoiceId="${b2bInvoiceId}" amountApplied="250" appliedDate="${effectiveTime}"/>
            <mantle.account.invoice.Invoice invoiceId="${b2bCredMemoId}" invoiceTypeEnumId="InvoiceCreditMemo"
                fromPartyId="JoeDist" toPartyId="ORG_ZIZI_RETAIL" statusId="InvoicePmtSent" invoiceDate="${effectiveTime}"
                currencyUomId="USD" invoiceTotal="250" appliedPaymentsTotal="250" unpaidTotal="0"/>
            <mantle.account.invoice.Invoice invoiceId="${b2bInvoiceId}" invoiceTypeEnumId="InvoiceSales"
                fromPartyId="ORG_ZIZI_RETAIL" toPartyId="JoeDist" statusId="InvoiceFinalized" invoiceDate="${effectiveTime}"
                currencyUomId="USD" invoiceTotal="1610.0" appliedPaymentsTotal="250" unpaidTotal="1360.0"/>

            <mantle.ledger.transaction.AcctgTrans acctgTransId="55511" acctgTransTypeEnumId="AttInvoiceInOutAppl"
                    organizationPartyId="ORG_ZIZI_RETAIL" transactionDate="${effectiveTime}" isPosted="Y"
                    postedDate="${effectiveTime}" glFiscalTypeEnumId="GLFT_ACTUAL" amountUomId="USD"
                    otherPartyId="JoeDist" invoiceId="${b2bCredMemoId}" toInvoiceId="${b2bInvoiceId}"
                    paymentApplicationId="${paymentApplicationId}">
                <mantle.ledger.transaction.AcctgTransEntry acctgTransEntrySeqId="01" debitCreditFlag="D"
                        amount="250" glAccountId="212000000" reconcileStatusId="AterNot" isSummary="N"/>
                <mantle.ledger.transaction.AcctgTransEntry acctgTransEntrySeqId="02" debitCreditFlag="C"
                        amount="250" glAccountId="121000000" reconcileStatusId="AterNot" isSummary="N"/>
            </mantle.ledger.transaction.AcctgTrans>
        </entity-facade-xml>`)
        return { dataCheckErrors }
    },
    then({ dataCheckErrors }) {
        dataCheckErrors.length == 0
    },
})

feature("receive and Apply Customer Overpayment", {
    when() {
        const overpayAmount = String(dec("1500.0").subtract("1360.0"))
        call("mantle.account.PaymentServices.update#Payment",
                { paymentId: b2bPaymentId, amount: 1500.0, effectiveDate: new Date(effectiveTime) })
        call("mantle.account.PaymentServices.update#Payment",
                { paymentId: b2bPaymentId, statusId: "PmntDelivered" })

        const dataCheckErrors = check(`<entity-facade-xml>
            <mantle.account.payment.Payment paymentId="${b2bPaymentId}" statusId="PmntDelivered"
                effectiveDate="${effectiveTime}" amount="1500" appliedTotal="1360.0" unappliedTotal="${overpayAmount}"/>

            <!-- TODO: AcctgTrans 55509 for incoming payment, 55510 for incoming payment appl -->
        </entity-facade-xml>`)
        return { dataCheckErrors }
    },
    then({ dataCheckErrors }) {
        dataCheckErrors.length == 0
    },
})

feature("refund Customer Overpayment", {
    when() {
        const overpayAmount = String(dec("1500.0").subtract("1360.0"))
        // record sent refund Payment
        const refundPmtResult = call("mantle.account.PaymentServices.create#Payment",
                { paymentTypeEnumId: "PtRefund", statusId: "PmntDelivered", fromPartyId: "ORG_ZIZI_RETAIL",
                    toPartyId: "JoeDist", effectiveDate: new Date(effectiveTime), paymentRefNum: "1000",
                    paymentInstrumentEnumId: "PiCompanyCheck", paymentMethodId: "ZIRET_BA", amount: overpayAmount })
        // apply refund Payment to overpay Payment
        const refundApplResult = call("mantle.account.PaymentServices.apply#PaymentToPayment",
                { paymentId: refundPmtResult.paymentId, toPaymentId: b2bPaymentId })

        const dataCheckErrors = check(`<entity-facade-xml>
            <mantle.account.payment.PaymentApplication paymentApplicationId="${refundApplResult.paymentApplicationId}"
                paymentId="${refundPmtResult.paymentId}" toPaymentId="${b2bPaymentId}" amountApplied="${overpayAmount}"
                appliedDate="${effectiveTime}"/>
            <mantle.account.payment.Payment paymentId="${refundPmtResult.paymentId}" statusId="PmntDelivered"
                effectiveDate="${effectiveTime}" amount="${overpayAmount}" appliedTotal="${overpayAmount}" unappliedTotal="0"/>
            <mantle.account.payment.Payment paymentId="${b2bPaymentId}" statusId="PmntDelivered"
                effectiveDate="${effectiveTime}" amount="1500" appliedTotal="1500" unappliedTotal="0"/>

            <!-- AcctgTrans created for Delivered refund Payment -->
            <mantle.ledger.transaction.AcctgTrans acctgTransId="55514" acctgTransTypeEnumId="AttOutgoingPayment"
                    organizationPartyId="ORG_ZIZI_RETAIL" transactionDate="${effectiveTime}" isPosted="Y"
                    postedDate="${effectiveTime}" glFiscalTypeEnumId="GLFT_ACTUAL" amountUomId="USD"
                    otherPartyId="JoeDist" paymentId="${refundPmtResult.paymentId}">
                <mantle.ledger.transaction.AcctgTransEntry acctgTransEntrySeqId="01" debitCreditFlag="D"
                        amount="${overpayAmount}" glAccountId="216000000" reconcileStatusId="AterNot" isSummary="N"/>
                <mantle.ledger.transaction.AcctgTransEntry acctgTransEntrySeqId="02" debitCreditFlag="C"
                        amount="${overpayAmount}" glAccountId="111100000" reconcileStatusId="AterNot" isSummary="N"/>
            </mantle.ledger.transaction.AcctgTrans>

            <!-- AcctgTrans for payment to payment application -->
            <mantle.ledger.transaction.AcctgTrans acctgTransId="55515" acctgTransTypeEnumId="AttPaymentInOutAppl"
                    organizationPartyId="ORG_ZIZI_RETAIL" transactionDate="${effectiveTime}" isPosted="Y"
                    postedDate="${effectiveTime}" glFiscalTypeEnumId="GLFT_ACTUAL" amountUomId="USD"
                    otherPartyId="JoeDist" paymentId="${refundPmtResult.paymentId}" toPaymentId="${b2bPaymentId}"
                    paymentApplicationId="${refundApplResult.paymentApplicationId}">
                <mantle.ledger.transaction.AcctgTransEntry acctgTransEntrySeqId="01" debitCreditFlag="C"
                        amount="${overpayAmount}" glAccountId="216000000" reconcileStatusId="AterNot" isSummary="N"/>
                <mantle.ledger.transaction.AcctgTransEntry acctgTransEntrySeqId="02" debitCreditFlag="D"
                        amount="${overpayAmount}" glAccountId="126000000" reconcileStatusId="AterNot" isSummary="N"/>
            </mantle.ledger.transaction.AcctgTrans>
        </entity-facade-xml>`)
        return { refundApplResult, overpayAmount, dataCheckErrors }
    },
    then({ refundApplResult, overpayAmount, dataCheckErrors }) {
        refundApplResult.amountApplied == overpayAmount
        dataCheckErrors.length == 0
    },
})

/* ========== Inventory Reservation and Issuance Tests: pack/issue and unpack, cancel Shipment in late status ========== */

feature("create Inventory Tests Sales Order", {
    when() {
        login("john.doe")

        const addOut1 = call("mantle.order.OrderServices.add#OrderProductQuantity",
                { productId: "DEMO_UNIT", quantity: 10, customerPartyId: "CustJqp",
                    currencyUomId: "USD", productStoreId: "POPC_DEFAULT" })

        inventoryOrderId = addOut1.orderId

        call("mantle.order.OrderServices.set#OrderBillingShippingInfo",
                { orderId: inventoryOrderId, paymentMethodId: "CustJqpCc", shippingPostalContactMechId: "CustJqpAddr",
                    shippingTelecomContactMechId: "CustJqpTeln", carrierPartyId: "_NA_", shipmentMethodEnumId: "ShMthGround" })

        call("mantle.order.OrderServices.place#Order", { orderId: inventoryOrderId, requireInventory: false })
        call("mantle.order.OrderServices.approve#Order", { orderId: inventoryOrderId })

        // NOTE: this has sequenced IDs so is sensitive to run order!
        const dataCheckErrors = check(`<entity-facade-xml>
            <mantle.order.OrderHeader orderId="${inventoryOrderId}" entryDate="${effectiveTime}" placedDate="${effectiveTime}"
                statusId="OrderApproved" currencyUomId="USD" productStoreId="POPC_DEFAULT" grandTotal="10.00"/>
            <mantle.order.OrderPart orderId="${inventoryOrderId}" orderPartSeqId="01" vendorPartyId="ORG_ZIZI_RETAIL"
                customerPartyId="CustJqp" shipmentMethodEnumId="ShMthGround" postalContactMechId="CustJqpAddr"
                telecomContactMechId="CustJqpTeln" partTotal="10.00"/>
            <mantle.order.OrderItem orderId="${inventoryOrderId}" orderItemSeqId="01" orderPartSeqId="01" itemTypeEnumId="ItemProduct"
                productId="DEMO_UNIT" itemDescription="Demo Product One Unit" quantity="10" unitAmount="1.00"
                isModifiedPrice="N"/>

            <mantle.product.issuance.AssetReservation assetReservationId="55507" orderId="55502" orderItemSeqId="01"
                reservedDate="${effectiveTime}" quantity="10" quantityNotAvailable="0" quantityNotIssued="10" assetId="DEMO_UNITA"
                productId="DEMO_UNIT" sequenceNum="0" reservationOrderEnumId="AsResOrdFifoRec"/>
            <mantle.product.asset.AssetDetail assetDetailId="55525" assetId="DEMO_UNITA" orderId="55502" orderItemSeqId="01" 
                productId="DEMO_UNIT" assetReservationId="55507" availableToPromiseDiff="-10" effectiveDate="${effectiveTime}"/>
        </entity-facade-xml>`)

        const totals = assetTotals()
        return { dataCheckErrors, ...totals }
    },
    then({ dataCheckErrors, availableToPromiseTotal, quantityOnHandTotal, reservationTotal }) {
        dataCheckErrors.length == 0
        dec(quantityOnHandTotal).subtract(availableToPromiseTotal) == reservationTotal
    },
})

feature("ship Inventory Sales Order and Cancel Shipment", {
    when() {
        login("john.doe")

        const shipResult = call("mantle.shipment.ShipmentServices.create#OrderPartShipment",
                { orderId: inventoryOrderId, orderPartSeqId: "01", createPackage: true })

        call("mantle.shipment.ShipmentServices.pack#ShipmentProduct",
                { productId: "DEMO_UNIT", quantity: 10, shipmentId: shipResult.shipmentId, shipmentPackageSeqId: shipResult.shipmentPackageSeqId })

        call("mantle.shipment.ShipmentServices.pack#Shipment", { shipmentId: shipResult.shipmentId })
        call("mantle.shipment.ShipmentServices.ship#Shipment", { shipmentId: shipResult.shipmentId })
        call("mantle.shipment.ShipmentServices.cancel#Shipment", { shipmentId: shipResult.shipmentId })

        // NOTE: this has sequenced IDs so is sensitive to run order!
        const dataCheckErrors = check(`<entity-facade-xml>
            <mantle.product.issuance.AssetIssuance assetIssuanceId="55508" assetId="DEMO_UNITA" orderId="55502" orderItemSeqId="01" 
                    issuedDate="${effectiveTime}" shipmentId="55502" shipmentItemSourceId="55506" 
                    productId="DEMO_UNIT" quantity="0" quantityCancelled="10" assetReservationId="55507"
                    acctgTransResultEnumId="AtrSuccess" issuedByUserId="EX_JOHN_DOE">
                <mantle.product.asset.AssetDetail assetDetailId="55526" assetId="DEMO_UNITA" quantityOnHandDiff="-10" 
                        productId="DEMO_UNIT" shipmentId="55502" assetReservationId="55507" effectiveDate="${effectiveTime}"/>
                <mantle.product.asset.AssetDetail assetDetailId="55527" assetId="DEMO_UNITA" quantityOnHandDiff="10" availableToPromiseDiff="10"  
                        productId="DEMO_UNIT" shipmentId="55502" effectiveDate="${effectiveTime}"/>
                <mantle.order.OrderItemBilling orderItemBillingId="55512" orderId="55502" orderItemSeqId="01" amount="1" 
                        quantity="0" shipmentId="55502" invoiceId="55503" invoiceItemSeqId="01"/>
            </mantle.product.issuance.AssetIssuance>

            <mantle.product.issuance.AssetReservation assetReservationId="55508" orderId="55502" orderItemSeqId="01" 
                    reservedDate="${effectiveTime}" quantity="10" quantityNotAvailable="0" quantityNotIssued="10" assetId="DEMO_UNITA" 
                    productId="DEMO_UNIT" sequenceNum="0" reservationOrderEnumId="AsResOrdFifoRec"/>
            <mantle.product.asset.AssetDetail assetDetailId="55528" assetId="DEMO_UNITA" orderId="55502" orderItemSeqId="01"
                    productId="DEMO_UNIT" assetReservationId="55508" availableToPromiseDiff="-10" effectiveDate="${effectiveTime}"/>
        </entity-facade-xml>`)

        const totals = assetTotals()
        return { dataCheckErrors, ...totals }
    },
    then({ dataCheckErrors, availableToPromiseTotal, quantityOnHandTotal, reservationTotal }) {
        dataCheckErrors.length == 0
        dec(quantityOnHandTotal).subtract(availableToPromiseTotal) == reservationTotal
    },
})

feature("ship Partial Inventory Sales Order and Cancel Shipment", {
    when() {
        login("john.doe")

        const shipResult = call("mantle.shipment.ShipmentServices.create#OrderPartShipment",
                { orderId: inventoryOrderId, orderPartSeqId: "01", createPackage: true })
        const shipmentId = shipResult.shipmentId

        // pack partial
        call("mantle.shipment.ShipmentServices.pack#ShipmentProduct",
                { productId: "DEMO_UNIT", quantity: 5, shipmentId: shipResult.shipmentId, shipmentPackageSeqId: shipResult.shipmentPackageSeqId })
        // unpack
        const issuanceList = ec.entity.find("mantle.product.issuance.AssetIssuance").condition("shipmentId", shipmentId).list()
        for (const issuance of issuanceList) {
            call("mantle.shipment.ShipmentServices.unpack#ShipmentItemIssuance", { assetIssuanceId: issuance.assetIssuanceId })
        }

        // pack partial again
        call("mantle.shipment.ShipmentServices.pack#ShipmentProduct",
                { productId: "DEMO_UNIT", quantity: 5, shipmentId: shipResult.shipmentId, shipmentPackageSeqId: shipResult.shipmentPackageSeqId })

        call("mantle.shipment.ShipmentServices.pack#Shipment", { shipmentId: shipResult.shipmentId })
        call("mantle.shipment.ShipmentServices.ship#Shipment", { shipmentId: shipResult.shipmentId })
        call("mantle.shipment.ShipmentServices.cancel#Shipment", { shipmentId: shipResult.shipmentId })

        // NOTE: this has sequenced IDs so is sensitive to run order!
        const dataCheckErrors = check(`<entity-facade-xml>
        </entity-facade-xml>`)

        const totals = assetTotals()
        return { dataCheckErrors, ...totals }
    },
    then({ dataCheckErrors, availableToPromiseTotal, quantityOnHandTotal, reservationTotal }) {
        dataCheckErrors.length == 0
        dec(quantityOnHandTotal).subtract(availableToPromiseTotal) == reservationTotal
    },
})

// NOTE: do this last because deals with unpredictable data (number of AssetDetail, etc records) from the thread race in asset reservations
feature("reserve Asset With Displace Reservation", {
    when() {
        // NOTE: orders used here are from AssetReservationMultipleThreads (base id 53000)
        // use asset DEMO_1_1A with 0 ATP at this point (90 QOH, 2 reservations for orders)
        // use order with 60 currently reserved against asset 55400

        let beforeResList = ec.entity.find("mantle.product.issuance.AssetReservation")
                .condition("assetId", "DEMO_1_1A").orderBy("assetId").list()
        for (const res of beforeResList) log.warn("Res before: R:" + res.assetReservationId + " - O:" + res.orderId + " - A:" + res.assetId + " - " + String(res.quantity))

        beforeResList = ec.entity.find("mantle.product.issuance.AssetReservation")
                .condition("assetId", "55400").orderBy("assetId").list()
        for (const res of beforeResList) log.warn("Res before: R:" + res.assetReservationId + " - O:" + res.orderId + " - A:" + res.assetId + " - " + String(res.quantity))

        const beforeRes = beforeResList.find(r => dec(r.quantity).compare(60) == 0)
        const orderId = beforeRes.orderId
        const orderItemSeqId = beforeRes.orderItemSeqId

        call("mantle.product.AssetServices.reserve#AssetForOrderItem",
                { orderId, orderItemSeqId, assetId: "DEMO_1_1A", resetReservations: true })

        const afterResList = ec.entity.find("mantle.product.issuance.AssetReservation")
                .condition("orderId", orderId).condition("orderItemSeqId", orderItemSeqId).orderBy("assetId").list()
        for (const res of afterResList) log.info("Res after: R:" + res.assetReservationId + " - O:" + res.orderId + " - A:" + res.assetId + " - " + String(res.quantity))
        const afterRes = afterResList.find(r => r.assetId == "DEMO_1_1A")
        return { afterRes }
    },
    then({ afterRes }) {
        afterRes != null
        afterRes?.assetId == "DEMO_1_1A"
        afterRes?.quantity == 60.0
    },
})
