// Port of ReturnToResponseBasicFlow.groovy: return of a sales order with replace, refund and credit responses,
// partial receipt, replacement order shipment, and a purchase paid with the customer credit financial account.
const effectiveTime = Date.now()
let returnId = null, returnShipmentId
const originalOrderId = "55500"
let replaceShipResult

spec({
    dependsOn: ["OrderToCashTime"],
    tempSequences: { start: 55700, banks: {
        "mantle.account.invoice.Invoice": 10,
        "mantle.account.financial.FinancialAccount": 10,
        "mantle.account.financial.FinancialAccountAuth": 10,
        "mantle.account.financial.FinancialAccountTrans": 10,
        "mantle.account.method.PaymentGatewayResponse": 10,
        "mantle.account.payment.Payment": 10,
        "mantle.account.payment.PaymentApplication": 10,
        "mantle.ledger.transaction.AcctgTrans": 10,
        "mantle.product.asset.Asset": 10,
        "mantle.product.asset.AssetDetail": 10,
        "mantle.product.issuance.AssetReservation": 10,
        "mantle.product.issuance.AssetIssuance": 10,
        "mantle.product.receipt.AssetReceipt": 10,
        "mantle.order.OrderHeader": 10,
        "mantle.order.return.ReturnHeader": 10,
        "mantle.order.return.ReturnItemBilling": 10,
        "mantle.shipment.Shipment": 10,
        "mantle.shipment.ShipmentItemSource": 10 } },
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

feature("create Return From Order", {
    when() {
        login("joe@public.com")

        // create return
        const createMap = call("mantle.order.ReturnServices.create#ReturnFromOrder", { orderId: originalOrderId, orderPartSeqId: '01' })
        returnId = createMap.returnId

        // add items
        call("mantle.order.ReturnServices.add#OrderItemToReturn",
                { returnId: returnId, orderId: originalOrderId, orderItemSeqId: '01', returnQuantity: 1,
                    returnReasonEnumId: 'RrsnMisShip', returnResponseEnumId: 'RrspReplace' })
        call("mantle.order.ReturnServices.add#OrderItemToReturn",
                { returnId: returnId, orderId: originalOrderId, orderItemSeqId: '02', returnQuantity: 2,
                    returnReasonEnumId: 'RrsnDefective', returnResponseEnumId: 'RrspRefund' })
        call("mantle.order.ReturnServices.add#OrderItemToReturn",
                { returnId: returnId, orderId: originalOrderId, orderItemSeqId: '03', returnQuantity: 3,
                    returnReasonEnumId: 'RrsnDidNotWant', returnResponseEnumId: 'RrspCredit' })

        // submit return request
        call("mantle.order.ReturnServices.request#Return", { returnId: returnId })

        logout()

        const dataCheckErrors = check(`<entity-facade-xml>
            <returns returnId="55700" facilityId="ZIRET_WH" entryDate="${effectiveTime}"
                    shipmentMethodEnumId="ShMthGround" vendorPartyId="ORG_ZIZI_RETAIL" telecomContactMechId="CustJqpTeln"
                    postalContactMechId="CustJqpAddr" carrierPartyId="_NA_" currencyUomId="USD" statusId="ReturnRequested"
                    paymentMethodId="CustJqpCc" customerPartyId="CustJqp">
                <items returnItemSeqId="01" orderId="55500" orderItemSeqId="01" returnReasonEnumId="RrsnMisShip"
                    returnQuantity="1" productId="DEMO_1_1" description="Demo Product One-One" itemTypeEnumId="ItemProduct"
                    statusId="ReturnRequested" returnResponseEnumId="RrspReplace"/>
                <items returnItemSeqId="02" orderId="55500" orderItemSeqId="02" returnReasonEnumId="RrsnDefective"
                    returnQuantity="2" productId="DEMO_3_1" description="Demo Product Three-One" itemTypeEnumId="ItemProduct"
                    statusId="ReturnRequested" returnResponseEnumId="RrspRefund"/>
                <items returnItemSeqId="05" orderId="55500" orderItemSeqId="03" returnReasonEnumId="RrsnDidNotWant"
                    returnQuantity="3" productId="DEMO_2_1" description="Demo Product Two-One" itemTypeEnumId="ItemProduct"
                    statusId="ReturnRequested" returnResponseEnumId="RrspCredit"/>
            </returns>
        </entity-facade-xml>`)
        return { dataCheckErrors }
    },
    then({ dataCheckErrors }) {
        dataCheckErrors.length == 0
    },
})

feature("approve Return", {
    when() {
        login("john.doe")

        // triggers SECA rule to create an Sales Return (incoming) Shipment
        call("mantle.order.ReturnServices.approve#Return", { returnId: returnId })

        const dataCheckErrors = check(`<entity-facade-xml>
            <returns returnId="55700" statusId="ReturnApproved"/>
        </entity-facade-xml>`)
        return { dataCheckErrors }
    },
    then({ dataCheckErrors }) {
        dataCheckErrors.length == 0
    },
})

feature("receive Return Shipment", {
    when() {

        // find Shipment created on return approve
        const sisEl = ec.entity.find("mantle.shipment.ShipmentItemSource").condition("returnId", returnId).list()
        returnShipmentId = sisEl.get(0).shipmentId

        // receive Return Shipment
        // triggers SECA rules to receive ReturnItems

        // receive individually to do partial return receipt for DEMO_2_1 (2 of 3) to test prorating of responses
        call("mantle.shipment.ShipmentServices.receive#ShipmentProduct",
                { shipmentId: returnShipmentId, productId: 'DEMO_1_1', statusId: 'AstOnHold', quantityAccepted: 1.0 })
        call("mantle.shipment.ShipmentServices.receive#ShipmentProduct",
                { shipmentId: returnShipmentId, productId: 'DEMO_2_1', statusId: 'AstOnHold', quantityAccepted: 2.0 })
        call("mantle.shipment.ShipmentServices.receive#ShipmentProduct",
                { shipmentId: returnShipmentId, productId: 'DEMO_3_1', statusId: 'AstOnHold', quantityAccepted: 2.0 })

        call("mantle.shipment.ShipmentServices.deliver#Shipment", { shipmentId: returnShipmentId })

        const dataCheckErrors = check(`<entity-facade-xml>
            <shipments shipmentId="55700" fromPartyId="CustJqp" toPartyId="ORG_ZIZI_RETAIL"
                    shipmentTypeEnumId="ShpTpSalesReturn" statusId="ShipDelivered">
                <items quantity="1" productId="DEMO_1_1">
                    <sources shipmentItemSourceId="55700" quantity="1" statusId="SisReceived" quantityNotHandled="0"
                        returnId="55700" returnItemSeqId="01"/>
                </items>
                <items quantity="2" productId="DEMO_2_1">
                    <sources shipmentItemSourceId="55702" quantity="2" statusId="SisReceived" quantityNotHandled="0"
                        returnId="55700" returnItemSeqId="05"/>
                </items>
                <items quantity="2" productId="DEMO_3_1">
                    <sources shipmentItemSourceId="55701" quantity="2" statusId="SisReceived" quantityNotHandled="0"
                        returnId="55700" returnItemSeqId="02"/>
                </items>
                <routeSegments shipmentRouteSegmentSeqId="01" shipmentMethodEnumId="ShMthGround"
                    destinationFacilityId="ZIRET_WH" originPostalContactMechId="CustJqpAddr"
                    carrierPartyId="_NA_" originTelecomContactMechId="CustJqpTeln"/>
            </shipments>
        </entity-facade-xml>`)
        return { dataCheckErrors }
    },
    then({ dataCheckErrors }) {
        dataCheckErrors.length == 0
    },
})

feature("validate Return Completed", {
    when() {
        const dataCheckErrors = check(`<entity-facade-xml>
            <returns returnId="55700" statusId="ReturnCompleted">
                <items returnItemSeqId="01" responseDate="${effectiveTime}" replacementOrderId="55700"
                        statusId="ReturnCompleted" receivedQuantity="1">
                    <receipts assetReceiptId="55700" productId="DEMO_1_1" quantityAccepted="1"
                        acctgTransResultEnumId="AtrNoAcquireCost" quantityRejected="0" assetId="55700" shipmentId="55700"
                        receivedByUserId="EX_JOHN_DOE" receivedDate="${effectiveTime}"/>
                    <mantle.product.asset.AssetDetail assetDetailId="55701" productId="DEMO_1_1" assetId="55700"
                        availableToPromiseDiff="1" shipmentId="55700" assetReceiptId="55700" effectiveDate="${effectiveTime}"
                        quantityOnHandDiff="1"/>
                </items>
                <items returnItemSeqId="02" orderItemSeqId="02" responseDate="${effectiveTime}" refundPaymentId="55701"
                        statusId="ReturnCompleted" responseAmount="15.54" receivedQuantity="2" returnQuantity="2">
                    <receipts assetReceiptId="55702" productId="DEMO_3_1" quantityAccepted="2"
                        acctgTransResultEnumId="AtrNoAcquireCost" quantityRejected="0" assetId="55702" shipmentId="55700"
                        receivedByUserId="EX_JOHN_DOE" receivedDate="${effectiveTime}"/>
                    <mantle.product.asset.AssetDetail assetDetailId="55703" productId="DEMO_3_1" assetId="55702"
                        availableToPromiseDiff="2" shipmentId="55700" assetReceiptId="55702" effectiveDate="${effectiveTime}"
                        quantityOnHandDiff="2"/>
                </items>
                <items returnItemSeqId="05" orderItemSeqId="03" responseDate="${effectiveTime}" refundPaymentId="55700" finAccountTransId="55700" 
                        statusId="ReturnCompleted" responseAmount="24.24" receivedQuantity="2" returnQuantity="2">
                    <receipts assetReceiptId="55701" productId="DEMO_2_1" quantityAccepted="2"
                        acctgTransResultEnumId="AtrNoAcquireCost" quantityRejected="0" assetId="55701" shipmentId="55700"
                        receivedByUserId="EX_JOHN_DOE" receivedDate="${effectiveTime}"/>
                    <mantle.product.asset.AssetDetail assetDetailId="55702" productId="DEMO_2_1" assetId="55701"
                        availableToPromiseDiff="2" shipmentId="55700" assetReceiptId="55701" effectiveDate="${effectiveTime}"
                        quantityOnHandDiff="2"/>
                </items>
            </returns>
        </entity-facade-xml>`)
        return { dataCheckErrors }
    },
    then({ dataCheckErrors }) {
        dataCheckErrors.length == 0
    },
})

feature("validate Replacement Order and Asset Reservation", {
    when() {
        const dataCheckErrors = check(`<entity-facade-xml>
            <orders orderId="55700" entryDate="${effectiveTime}" grandTotal="0" currencyUomId="USD"
                    statusId="OrderApproved" placedDate="${effectiveTime}">
                <parts shipmentMethodEnumId="ShMthGround" telecomContactMechId="CustJqpTeln" postalContactMechId="CustJqpAddr" partTotal="0" customerPartyId="CustJqp" lastUpdatedStamp="1450573654119" facilityId="ZIRET_WH" vendorPartyId="ORG_ZIZI_RETAIL" carrierPartyId="_NA_" statusId="OrderApproved" orderPartSeqId="01"/>
                <items orderItemSeqId="01" isModifiedPrice="Y" itemTypeEnumId="ItemProduct" quantity="1"
                        itemDescription="Demo Product One-One" productId="DEMO_1_1" unitAmount="0" orderPartSeqId="01">
                    <reservations assetReservationId="55700" assetId="55400" reservedDate="${effectiveTime}" quantity="1"
                            productId="DEMO_1_1" sequenceNum="0" quantityNotIssued="1" quantityNotAvailable="0"
                            reservationOrderEnumId="AsResOrdFifoRec">
                        <mantle.product.asset.AssetDetail assetDetailId="55700" assetId="55400" productId="DEMO_1_1"
                            availableToPromiseDiff="-1" effectiveDate="${effectiveTime}"/>
                    </reservations>
                </items>
            </orders>
        </entity-facade-xml>`)
        return { dataCheckErrors }
    },
    then({ dataCheckErrors }) {
        dataCheckErrors.length == 0
    },
})

feature("validate Return Credit Memo Invoice", {
    when() {
        const dataCheckErrors = check(`<entity-facade-xml>
            <invoices invoiceId="55700" fromPartyId="CustJqp" toPartyId="ORG_ZIZI_RETAIL" unpaidTotal="14" acctgTransResultEnumId="AtrSuccess" invoiceDate="${effectiveTime}" 
                    currencyUomId="USD" statusId="InvoiceApproved" invoiceTypeEnumId="InvoiceReturn" invoiceTotal="37.07" appliedPaymentsTotal="23.07">
                <paymentApplications paymentApplicationId="55700" paymentId="55700" amountApplied="23.07" appliedDate="${effectiveTime}" acctgTransResultEnumId="AtrSuccess"/>
                <items invoiceItemSeqId="01" amount="7.77" quantity="2" productId="DEMO_3_1" description="Demo Product Three-One" itemTypeEnumId="ItemProduct"/>
                <items invoiceItemSeqId="02" amount="-2.46" quantity="1" description="Discount why? Because we love you." itemTypeEnumId="ItemDiscount"/>
                <items invoiceItemSeqId="03" amount="0.92" quantity="1" description="Test Tax 7%" itemTypeEnumId="ItemSalesTax"/>
                <items invoiceItemSeqId="04" amount="12.12" quantity="2" productId="DEMO_2_1" description="Demo Product Two-One" itemTypeEnumId="ItemProduct"/>
                <items invoiceItemSeqId="05" amount="-4.02" quantity="0.666667" description="Discount why? Because we love you." itemTypeEnumId="ItemDiscount"/>
                <items invoiceItemSeqId="06" amount="2.26" quantity="0.666667" description="Test Tax 7%" itemTypeEnumId="ItemSalesTax"/>
            </invoices>
        </entity-facade-xml>`)
        return { dataCheckErrors }
    },
    then({ dataCheckErrors }) {
        dataCheckErrors.length == 0
    },
})

feature("validate Refund Payment", {
    when() {
        const dataCheckErrors = check(`<entity-facade-xml>
            <payments paymentId="55701" fromPartyId="ORG_ZIZI_RETAIL" toPartyId="CustJqp" amountUomId="USD"
                paymentTypeEnumId="PtRefund" toPaymentMethodId="CustJqpCc" amount="14.0" reconcileStatusId="PmtrNot"
                statusId="PmntPromised" paymentInstrumentEnumId="PiCreditCard"/>
        </entity-facade-xml>`)
        return { dataCheckErrors }
    },
    then({ dataCheckErrors }) {
        dataCheckErrors.length == 0
    },
})

feature("validate Customer Credit Financial Account Trans", {
    when() {
        const dataCheckErrors = check(`<entity-facade-xml>
            <mantle.account.financial.FinancialAccount finAccountId="55700" finAccountTypeId="CustomerCredit" isRefundable="Y"
                    actualBalance="23.07" availableBalance="23.07" ownerPartyId="CustJqp" currencyUomId="USD" statusId="FaActive"
                    finAccountName="Joe Public Customer Credit" organizationPartyId="ORG_ZIZI_RETAIL">
                <mantle.account.financial.FinancialAccountTrans finAccountTransId="55700" fromPartyId="ORG_ZIZI_RETAIL"
                        finAccountTransTypeEnumId="FattDeposit" reasonEnumId="FatrCsCredit" amount="23.07"
                        entryDate="${effectiveTime}" acctgTransResultEnumId="AtrSuccess" transactionDate="${effectiveTime}"
                        postBalance="23.07" toPartyId="CustJqp" performedByUserId="EX_JOHN_DOE"/>
            </mantle.account.financial.FinancialAccount>
            <mantle.ledger.transaction.AcctgTrans acctgTransId="55700" otherPartyId="CustJqp" postedDate="${effectiveTime}"
                    amountUomId="USD" isPosted="Y" acctgTransTypeEnumId="AttFinancialDeposit"
                    glFiscalTypeEnumId="GLFT_ACTUAL" transactionDate="${effectiveTime}" organizationPartyId="ORG_ZIZI_RETAIL">
                <mantle.ledger.transaction.AcctgTransEntry acctgTransEntrySeqId="01" amount="23.07" glAccountId="430000000"
                        reconcileStatusId="AterNot" isSummary="N" glAccountTypeEnumId="GatSales" debitCreditFlag="D"/>
                <mantle.ledger.transaction.AcctgTransEntry acctgTransEntrySeqId="02" amount="23.07" glAccountId="251100000"
                        reconcileStatusId="AterNot" isSummary="N" glAccountTypeEnumId="GatCustomerCredits" debitCreditFlag="C"/>
            </mantle.ledger.transaction.AcctgTrans>
        </entity-facade-xml>`)
        return { dataCheckErrors }
    },
    then({ dataCheckErrors }) {
        dataCheckErrors.length == 0
    },
})

feature("ship Replacement Order", {
    when() {

        // the first ReturnItem is the replace item
        const returnItem = ec.entity.find("mantle.order.return.ReturnItem").condition({ returnId: returnId, returnItemSeqId: '01' }).one()
        replaceShipResult = call("mantle.shipment.ShipmentServices.ship#OrderPart",
                { orderId: returnItem.replacementOrderId, orderPartSeqId: '01' })

        const dataCheckErrors = check(`<entity-facade-xml>
            <shipments shipmentId="55701" fromPartyId="ORG_ZIZI_RETAIL" toPartyId="CustJqp"
                    shipmentTypeEnumId="ShpTpSales" statusId="ShipShipped">
                <items quantity="1" productId="DEMO_1_1">
                    <sources shipmentItemSourceId="55703" quantity="1" orderId="55700" orderItemSeqId="01"
                            statusId="SisPacked" quantityNotHandled="0"/>
                    <contents shipmentPackageSeqId="01" quantity="1"/>
                </items>
                <packages shipmentPackageSeqId="01">
                    <contents quantity="1" productId="DEMO_1_1"/>
                    <routeSegments shipmentRouteSegmentSeqId="01"/>
                </packages>
                <routeSegments shipmentRouteSegmentSeqId="01" shipmentMethodEnumId="ShMthGround"
                        actualStartDate="${effectiveTime}" destTelecomContactMechId="CustJqpTeln"
                        originFacilityId="ZIRET_WH" destPostalContactMechId="CustJqpAddr"/>
            </shipments>
        </entity-facade-xml>`)
        return { dataCheckErrors }
    },
    then({ dataCheckErrors }) {
        dataCheckErrors.length == 0
    },
})

feature("validate Replacement Order Complete", {
    when() {
        const dataCheckErrors = check(`<entity-facade-xml>
            <!-- OrderHeader status to Completed -->
            <orders orderId="55700" statusId="OrderCompleted"><parts orderPartSeqId="01" statusId="OrderCompleted"/></orders>
        </entity-facade-xml>`)
        return { dataCheckErrors }
    },
    then({ dataCheckErrors }) {
        dataCheckErrors.length == 0
    },
})

feature("validate Asset Issuance and Accounting Transactions", {
    when() {
        const dataCheckErrors = check(`<entity-facade-xml>
            <mantle.product.issuance.AssetIssuance assetIssuanceId="55700" assetId="55400" shipmentId="55701"
                    orderId="55700" orderItemSeqId="01" issuedDate="${effectiveTime}" quantity="1" productId="DEMO_1_1"
                    assetReservationId="55700" acctgTransResultEnumId="AtrSuccess">
                <mantle.ledger.transaction.AcctgTrans acctgTransId="55704" postedDate="${effectiveTime}" amountUomId="USD" isPosted="Y"
                        assetId="55400" acctgTransTypeEnumId="AttInventoryIssuance" glFiscalTypeEnumId="GLFT_ACTUAL"
                        transactionDate="${effectiveTime}" organizationPartyId="ORG_ZIZI_RETAIL">
                    <mantle.ledger.transaction.AcctgTransEntry amount="8" productId="DEMO_1_1" glAccountId="141300000"
                            reconcileStatusId="AterNot" isSummary="N" glAccountTypeEnumId="GatInventory"
                            debitCreditFlag="C" assetId="55400" acctgTransEntrySeqId="01"/>
                    <mantle.ledger.transaction.AcctgTransEntry amount="8" productId="DEMO_1_1" glAccountId="512000000"
                            reconcileStatusId="AterNot" isSummary="N" glAccountTypeEnumId="GatCogs" debitCreditFlag="D"
                            assetId="55400" acctgTransEntrySeqId="02"/>
                </mantle.ledger.transaction.AcctgTrans>
                <mantle.product.asset.AssetDetail assetDetailId="55704" assetId="55400" productId="DEMO_1_1"
                        assetReservationId="55700" shipmentId="55701" effectiveDate="${effectiveTime}" quantityOnHandDiff="-1"/>
            </mantle.product.issuance.AssetIssuance>
        </entity-facade-xml>`)
        return { dataCheckErrors }
    },
    then({ dataCheckErrors }) {
        dataCheckErrors.length == 0
    },
})

feature("purchase with return credit", {
    when() {
        const productStoreId = "POPC_DEFAULT"

        // ========== place order as customer

        logout()
        login("joe@public.com")
        const customerPartyId = ec.user.userAccount.partyId
        // get customer credit account
        const custFaList = ec.entity.find("mantle.account.financial.FinancialAccount")
                .condition({ ownerPartyId: customerPartyId, finAccountTypeId: 'CustomerCredit' }).list()
        const finAccountId = custFaList[0].finAccountId

        const addOut1 = call("mantle.order.OrderServices.add#OrderProductQuantity",
                { productId: 'DEMO_3_1', quantity: 1, customerPartyId: customerPartyId, productStoreId: productStoreId })
        const orderId = addOut1.orderId
        const orderPartSeqId = addOut1.orderPartSeqId
        call("mantle.order.OrderServices.set#OrderBillingShippingInfo",
                { orderId: orderId, shippingPostalContactMechId: 'CustJqpAddr',
                    shippingTelecomContactMechId: 'CustJqpTeln', carrierPartyId: '_NA_',
                    shipmentMethodEnumId: 'ShMthGround', finAccountId: finAccountId })
        call("mantle.order.OrderServices.place#Order", { orderId: orderId })

        logout()

        // ========== ship/etc order as admin

        login("john.doe")
        call("mantle.order.OrderServices.approve#Order", { orderId: orderId })
        call("mantle.shipment.ShipmentServices.ship#OrderPart", { orderId: orderId, orderPartSeqId: orderPartSeqId })

        // ========== check data

        const dataCheckErrors = check(`<entity-facade-xml>
            <financialAccounts finAccountId="55700" negativeBalanceLimit="0" availableBalance="15.30"
                    actualBalance="15.30" ownerPartyId="CustJqp" organizationPartyId="ORG_ZIZI_RETAIL">
                <!-- NOTE: expireDate is set to now when payment is captured, so not in the future as when created -->
                <mantle.account.financial.FinancialAccountAuth finAccountAuthId="55700" amount="7.77" paymentId="55702"
                        authorizationDate="${effectiveTime}" expireDate="${effectiveTime}"/>
                <mantle.account.method.PaymentGatewayResponse paymentGatewayResponseId="55700"
                        paymentGatewayConfigId="FinancialAccountLocal" amountUomId="USD" paymentId="55702"
                        paymentOperationEnumId="PgoAuthorize" amount="7.77" resultDeclined="N" resultError="N"
                        transactionDate="${effectiveTime}" resultNsf="N" referenceNum="55700" resultSuccess="Y"/>
                <mantle.account.financial.FinancialAccountTrans finAccountTransId="55701" fromPartyId="CustJqp"
                        toPartyId="ORG_ZIZI_RETAIL" finAccountTransTypeEnumId="FattWithdraw" reasonEnumId="FatrDisbursement"
                        amount="-7.77" entryDate="${effectiveTime}" acctgTransResultEnumId="AtrSuccess"
                        transactionDate="${effectiveTime}" postBalance="15.30" finAccountAuthId="55700" performedByUserId="EX_JOHN_DOE"/>
                <acctgTrans acctgTransId="55708" otherPartyId="CustJqp" amountUomId="USD" isPosted="Y" acctgTransTypeEnumId="AttFinancialWithdrawal"
                        glFiscalTypeEnumId="GLFT_ACTUAL" transactionDate="${effectiveTime}" organizationPartyId="ORG_ZIZI_RETAIL">
                    <entries acctgTransEntrySeqId="01" amount="7.77" glAccountId="258200000" reconcileStatusId="AterNot" isSummary="N" debitCreditFlag="C"/>
                    <entries acctgTransEntrySeqId="02" amount="7.77" glAccountId="251100000" reconcileStatusId="AterNot" isSummary="N" debitCreditFlag="D"/>
                </acctgTrans>
                <mantle.account.method.PaymentGatewayResponse paymentGatewayResponseId="55701" paymentGatewayConfigId="FinancialAccountLocal"
                        responseCode="success" amountUomId="USD" resultDeclined="N" paymentId="55702" paymentOperationEnumId="PgoCapture" 
                        amount="7.77" resultError="N" resultNsf="N" referenceNum="55701" approvalCode="55701"
                        resultSuccess="Y" transactionDate="${effectiveTime}"/>
                <mantle.account.payment.Payment paymentId="55702" fromPartyId="CustJqp" paymentGatewayConfigId="FinancialAccountLocal"
                        amountUomId="USD" paymentTypeEnumId="PtInvoicePayment" finAccountTransId="55701" amount="7.77"
                        reconcileStatusId="PmtrNot" acctgTransResultEnumId="AtrSuccess" finAccountAuthId="55700" statusId="PmntDelivered"
                        paymentInstrumentEnumId="PiFinancialAccount" toPartyId="ORG_ZIZI_RETAIL" orderId="55701" orderPartSeqId="01">
                    <mantle.ledger.transaction.AcctgTrans acctgTransId="55709" otherPartyId="CustJqp" postedDate="${effectiveTime}"
                            amountUomId="USD" isPosted="Y" acctgTransTypeEnumId="AttIncomingPayment" glFiscalTypeEnumId="GLFT_ACTUAL"
                            transactionDate="${effectiveTime}" organizationPartyId="ORG_ZIZI_RETAIL">
                        <entries acctgTransEntrySeqId="01" amount="7.77" glAccountId="121000000" reconcileStatusId="AterNot"
                            isSummary="N" glAccountTypeEnumId="GatAccountsReceivable" debitCreditFlag="C"/>
                        <entries acctgTransEntrySeqId="02" amount="7.77" glAccountId="258200000" reconcileStatusId="AterNot"
                            isSummary="N" glAccountTypeEnumId="" debitCreditFlag="D"/>
                    </mantle.ledger.transaction.AcctgTrans>
                    <!-- NOTE: not checking acctgTransResultEnumId, could be success or payment not posted depending on if payment or application posts first -->
                    <applications amountApplied="7.77" appliedDate="${effectiveTime}"
                            paymentApplicationId="55701" invoiceId="55702"/>
                </mantle.account.payment.Payment>
            </financialAccounts>
        </entity-facade-xml>`)
        return { dataCheckErrors }
    },
    then({ dataCheckErrors }) {
        dataCheckErrors.length == 0
    },
})
