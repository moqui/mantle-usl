/*
 * This software is in the public domain under CC0 1.0 Universal plus a 
 * Grant of Patent License.
 * 
 * To the extent possible under law, the author(s) have dedicated all
 * copyright and related and neighboring rights to this software to the
 * public domain worldwide. This software is distributed without any
 * warranty.
 * 
 * You should have received a copy of the CC0 Public Domain Dedication
 * along with this software (see the LICENSE.md file). If not, see
 * <http://creativecommons.org/publicdomain/zero/1.0/>.
 */

import org.moqui.Moqui
import org.moqui.context.ExecutionContext
import org.moqui.entity.EntityValue
import org.slf4j.Logger
import org.slf4j.LoggerFactory
import spock.lang.Shared
import spock.lang.Specification

import java.sql.Timestamp

/* To run these make sure moqui, and mantle are in place and run:
    "gradle cleanAll load runtime/mantle/mantle-usl:test"
   Or to quick run with saved DB copy use "gradle loadSave" once then each time "gradle reloadSave runtime/mantle/mantle-usl:test"
 */
class OrderToCashBasicFlow extends Specification {
    @Shared
    protected final static Logger logger = LoggerFactory.getLogger(OrderToCashBasicFlow.class)
    @Shared
    ExecutionContext ec
    @Shared
    String cartOrderId = null, orderPartSeqId
    @Shared
    Map setInfoOut, shipResult
    @Shared
    long effectiveTime = System.currentTimeMillis()
    @Shared
    boolean kieEnabled = false

    def setupSpec() {
        // init the framework, get the ec
        ec = Moqui.getExecutionContext()
        // set an effective date so data check works, etc
        ec.user.setEffectiveTime(new Timestamp(effectiveTime))
        kieEnabled = ec.factory.getToolFactory("KIE") != null

        ec.entity.tempSetSequencedIdPrimary("mantle.account.method.PaymentGatewayResponse", 55500, 10)
        ec.entity.tempSetSequencedIdPrimary("mantle.ledger.transaction.AcctgTrans", 55500, 10)
        ec.entity.tempSetSequencedIdPrimary("mantle.shipment.Shipment", 55500, 10)
        ec.entity.tempSetSequencedIdPrimary("mantle.shipment.ShipmentItemSource", 55500, 10)
        ec.entity.tempSetSequencedIdPrimary("mantle.product.asset.Asset", 55500, 10)
        ec.entity.tempSetSequencedIdPrimary("mantle.product.asset.AssetDetail", 55500, 10)
        ec.entity.tempSetSequencedIdPrimary("mantle.product.asset.PhysicalInventory", 55500, 10)
        ec.entity.tempSetSequencedIdPrimary("mantle.product.issuance.AssetReservation", 55500, 10)
        ec.entity.tempSetSequencedIdPrimary("mantle.product.issuance.AssetIssuance", 55500, 10)
        ec.entity.tempSetSequencedIdPrimary("mantle.account.invoice.Invoice", 55500, 10)
        ec.entity.tempSetSequencedIdPrimary("mantle.account.payment.Payment", 55500, 10)
        ec.entity.tempSetSequencedIdPrimary("mantle.account.payment.PaymentApplication", 55500, 10)
        ec.entity.tempSetSequencedIdPrimary("mantle.order.OrderHeader", 55500, 10)
        ec.entity.tempSetSequencedIdPrimary("mantle.order.OrderItemBilling", 55500, 10)
    }

    def cleanupSpec() {
        ec.entity.tempResetSequencedIdPrimary("mantle.account.method.PaymentGatewayResponse")
        ec.entity.tempResetSequencedIdPrimary("mantle.ledger.transaction.AcctgTrans")
        ec.entity.tempResetSequencedIdPrimary("mantle.shipment.Shipment")
        ec.entity.tempResetSequencedIdPrimary("mantle.shipment.ShipmentItemSource")
        ec.entity.tempResetSequencedIdPrimary("mantle.product.asset.Asset")
        ec.entity.tempResetSequencedIdPrimary("mantle.product.asset.AssetDetail")
        ec.entity.tempResetSequencedIdPrimary("mantle.product.asset.PhysicalInventory")
        ec.entity.tempResetSequencedIdPrimary("mantle.product.issuance.AssetReservation")
        ec.entity.tempResetSequencedIdPrimary("mantle.product.issuance.AssetIssuance")
        ec.entity.tempResetSequencedIdPrimary("mantle.account.invoice.Invoice")
        ec.entity.tempResetSequencedIdPrimary("mantle.account.payment.Payment")
        ec.entity.tempResetSequencedIdPrimary("mantle.account.payment.PaymentApplication")
        ec.entity.tempResetSequencedIdPrimary("mantle.order.OrderHeader")
        ec.entity.tempResetSequencedIdPrimary("mantle.order.OrderItemBilling")
        ec.destroy()

        ec.factory.waitWorkerPoolEmpty(50) // up to 5 seconds
    }

    def setup() {
        ec.artifactExecution.disableAuthz()
    }

    def cleanup() {
        ec.artifactExecution.enableAuthz()
    }

    def "create Sales Order"() {
        when:
        ec.user.loginUser("joe@public.com", "moqui")

        String productStoreId = "POPC_DEFAULT"
        EntityValue productStore = ec.entity.find("mantle.product.store.ProductStore").condition("productStoreId", productStoreId).one()
        String currencyUomId = productStore.defaultCurrencyUomId
        String priceUomId = productStore.defaultCurrencyUomId
        // String defaultLocale = productStore.defaultLocale
        // String organizationPartyId = productStore.organizationPartyId
        String vendorPartyId = productStore.organizationPartyId
        String customerPartyId = ec.user.userAccount.partyId

        Map priceMap = ec.service.sync().name("mantle.product.PriceServices.get#ProductPrice")
                .parameters([productId:'DEMO_1_1', priceUomId:priceUomId, productStoreId:productStoreId,
                    vendorPartyId:vendorPartyId, customerPartyId:customerPartyId]).call()

        Map addOut1 = ec.service.sync().name("mantle.order.OrderServices.add#OrderProductQuantity")
                .parameters([productId:'DEMO_1_1', quantity:1, customerPartyId:customerPartyId,
                    currencyUomId:currencyUomId, productStoreId:productStoreId]).call()

        cartOrderId = addOut1.orderId
        orderPartSeqId = addOut1.orderPartSeqId

        // without orderPartSeqId
        Map addOut2 = ec.service.sync().name("mantle.order.OrderServices.add#OrderProductQuantity")
                .parameters([orderId:cartOrderId, productId:'DEMO_3_1', quantity:5]).call()
        // with orderPartSeqId
        Map addOut3 = ec.service.sync().name("mantle.order.OrderServices.add#OrderProductQuantity")
                .parameters([orderId:cartOrderId, orderPartSeqId:orderPartSeqId, productId:'DEMO_2_1', quantity:7]).call()

        setInfoOut = ec.service.sync().name("mantle.order.OrderServices.set#OrderBillingShippingInfo")
                .parameters([orderId:cartOrderId, paymentMethodId:'CustJqpCc', shippingPostalContactMechId:'CustJqpAddr',
                    shippingTelecomContactMechId:'CustJqpTeln', carrierPartyId:'_NA_', shipmentMethodEnumId:'ShMthGround']).call()
        ec.service.sync().name("mantle.order.OrderServices.place#Order").parameters([orderId:cartOrderId]).call()

        ec.user.logoutUser()

        // explicitly approve order as john.doe (has pre-approve warnings for unavailable inventory so must be done explicitly)
        ec.user.loginUser("john.doe", "moqui")
        ec.service.sync().name("mantle.order.OrderServices.approve#Order").parameters([orderId:cartOrderId]).call()
        ec.user.logoutUser()

        // NOTE: this has sequenced IDs so is sensitive to run order!
        List<String> dataCheckErrors = ec.entity.makeDataLoader().xmlText("""<entity-facade-xml>
            <mantle.order.OrderHeader orderId="${cartOrderId}" entryDate="${effectiveTime}" placedDate="${effectiveTime}"
                statusId="OrderApproved" currencyUomId="USD" productStoreId="POPC_DEFAULT" grandTotal="${kieEnabled ? '145.68' : '140.68'}"/>

            <mantle.account.payment.Payment paymentId="${setInfoOut.paymentId}" paymentTypeEnumId="PtInvoicePayment"
                paymentMethodId="CustJqpCc" paymentInstrumentEnumId="PiCreditCard" orderId="${cartOrderId}"
                orderPartSeqId="01" statusId="PmntAuthorized" amount="${kieEnabled ? '145.68' : '140.68'}"
                amountUomId="USD" fromPartyId="CustJqp" toPartyId="ORG_ZIZI_RETAIL"/>
            <mantle.account.method.PaymentGatewayResponse paymentGatewayResponseId="55500"
                paymentOperationEnumId="PgoAuthorize"
                paymentId="${setInfoOut.paymentId}" paymentMethodId="CustJqpCc" amount="${kieEnabled ? '145.68' : '140.68'}"
                amountUomId="USD" transactionDate="${effectiveTime}" resultSuccess="Y" resultDeclined="N" resultNsf="N"
                resultBadExpire="N" resultBadCardNumber="N"/>
            <!-- don't validate these, allow any payment gateway: paymentGatewayConfigId="TEST_APPROVE" referenceNum="TEST" -->

            <mantle.order.OrderPart orderId="${cartOrderId}" orderPartSeqId="01" vendorPartyId="ORG_ZIZI_RETAIL"
                customerPartyId="CustJqp" shipmentMethodEnumId="ShMthGround" postalContactMechId="CustJqpAddr"
                telecomContactMechId="CustJqpTeln" partTotal="${kieEnabled ? '145.68' : '140.68'}"/>
            <mantle.order.OrderItem orderId="${cartOrderId}" orderItemSeqId="01" orderPartSeqId="01" itemTypeEnumId="ItemProduct"
                productId="DEMO_1_1" itemDescription="Demo Product One-One" quantity="1" unitAmount="16.99"
                unitListPrice="19.99" isModifiedPrice="N"/>
            <mantle.order.OrderItem orderId="${cartOrderId}" orderItemSeqId="02" orderPartSeqId="01" itemTypeEnumId="ItemProduct"
                productId="DEMO_3_1" itemDescription="Demo Product Three-One" quantity="5" unitAmount="7.77"
                unitListPrice="" isModifiedPrice="N"/>
            <mantle.order.OrderItem orderId="${cartOrderId}" orderItemSeqId="03" orderPartSeqId="01" itemTypeEnumId="ItemProduct"
                productId="DEMO_2_1" itemDescription="Demo Product Two-One" quantity="7" unitAmount="12.12"
                unitListPrice="" isModifiedPrice="N"/>
        </entity-facade-xml>""").check()
        logger.info("create Sales Order data check results: " + dataCheckErrors)

        then:
        priceMap.price == 16.99
        priceMap.priceUomId == 'USD'
        vendorPartyId == 'ORG_ZIZI_RETAIL'
        customerPartyId == 'CustJqp'

        dataCheckErrors.size() == 0
    }

    def "validate Asset Reservation"() {
        when:
        // NOTE: this has sequenced IDs so is sensitive to run order!
        List<String> dataCheckErrors = ec.entity.makeDataLoader().xmlText("""<entity-facade-xml>
            <!-- Asset created, issued, changed record in detail -->

            <mantle.product.asset.Asset assetId="55400" acquireCost="8" acquireCostUomId="USD" productId="DEMO_1_1"
                statusId="AstAvailable" assetTypeEnumId="AstTpInventory" originalQuantity="400" quantityOnHandTotal="400"
                availableToPromiseTotal="199" facilityId="ZIRET_WH" ownerPartyId="ORG_ZIZI_RETAIL"
                hasQuantity="Y" assetName="Demo Product One-One"/>
            <mantle.product.issuance.AssetReservation assetReservationId="55500" assetId="55400" orderId="${cartOrderId}"
                orderItemSeqId="01" reservedDate="${effectiveTime}" quantity="1" productId="DEMO_1_1" sequenceNum="0"
                quantityNotIssued="1" quantityNotAvailable="0" reservationOrderEnumId="AsResOrdFifoRec"/>
            <mantle.product.asset.AssetDetail assetDetailId="55500" assetId="55400" productId="DEMO_1_1"
                assetReservationId="55500" availableToPromiseDiff="-1" effectiveDate="${effectiveTime}"/>

            <mantle.product.asset.Asset assetId="DEMO_3_1A" assetTypeEnumId="AstTpInventory" statusId="AstAvailable"
                ownerPartyId="ORG_ZIZI_RETAIL" productId="DEMO_3_1" hasQuantity="Y" quantityOnHandTotal="5"
                availableToPromiseTotal="0" receivedDate="1265184000000" facilityId="ZIRET_WH"/>
            <mantle.product.issuance.AssetReservation assetReservationId="55501" assetId="DEMO_3_1A" productId="DEMO_3_1"
                orderId="${cartOrderId}" orderItemSeqId="02" reservationOrderEnumId="AsResOrdFifoRec" quantity="5"
                reservedDate="${effectiveTime}" sequenceNum="0"/>
            <mantle.product.asset.AssetDetail assetDetailId="55501" assetId="DEMO_3_1A" effectiveDate="${effectiveTime}"
                availableToPromiseDiff="-5" assetReservationId="55501" productId="DEMO_3_1"/>

            <!-- this is an auto-created Asset based on the inventory issuance -->
            <mantle.product.asset.Asset assetId="55500" assetTypeEnumId="AstTpInventory" statusId="AstAvailable"
                ownerPartyId="ORG_ZIZI_RETAIL" productId="DEMO_2_1" hasQuantity="Y" quantityOnHandTotal="0"
                availableToPromiseTotal="-7" receivedDate="${effectiveTime}" facilityId="ZIRET_WH"/>
            <mantle.product.issuance.AssetReservation assetReservationId="55502" assetId="55500" productId="DEMO_2_1"
                orderId="${cartOrderId}" orderItemSeqId="03" reservationOrderEnumId="AsResOrdFifoRec"
                quantity="7" quantityNotAvailable="7" reservedDate="${effectiveTime}"/>
            <mantle.product.asset.AssetDetail assetDetailId="55502" assetId="55500" effectiveDate="${effectiveTime}"
                availableToPromiseDiff="-7" assetReservationId="55502" productId="DEMO_2_1"/>
        </entity-facade-xml>""").check()
        logger.info("validate Asset Reservation data check results: ")
        for (String dataCheckError in dataCheckErrors) logger.info(dataCheckError)

        then:
        dataCheckErrors.size() == 0
    }

    def "ship Sales Order"() {
        when:
        ec.user.loginUser("john.doe", "moqui")

        shipResult = ec.service.sync().name("mantle.shipment.ShipmentServices.ship#OrderPart")
                .parameters([orderId:cartOrderId, orderPartSeqId:orderPartSeqId, tryAutoPackage:false]).call()

        // NOTE: this has sequenced IDs so is sensitive to run order!
        List<String> dataCheckErrors = ec.entity.makeDataLoader().xmlText("""<entity-facade-xml>
            <!-- Shipment created -->
            <mantle.shipment.Shipment shipmentId="${shipResult.shipmentId}" shipmentTypeEnumId="ShpTpSales"
                statusId="ShipShipped" fromPartyId="ORG_ZIZI_RETAIL" toPartyId="CustJqp"/>
            <mantle.shipment.ShipmentPackage shipmentId="${shipResult.shipmentId}" shipmentPackageSeqId="01"/>

            <mantle.shipment.ShipmentItem shipmentId="${shipResult.shipmentId}" productId="DEMO_1_1" quantity="1"/>
            <mantle.shipment.ShipmentItemSource shipmentItemSourceId="55500" shipmentId="${shipResult.shipmentId}"
                productId="DEMO_1_1" orderId="${cartOrderId}" orderItemSeqId="01" statusId="SisPacked" quantity="1"
                invoiceId="55500" invoiceItemSeqId="01"/>
            <mantle.shipment.ShipmentPackageContent shipmentId="${shipResult.shipmentId}" shipmentPackageSeqId="01"
                productId="DEMO_1_1" quantity="1"/>

            <mantle.shipment.ShipmentItem shipmentId="${shipResult.shipmentId}" productId="DEMO_3_1" quantity="5"/>
            <mantle.shipment.ShipmentItemSource shipmentItemSourceId="55501" shipmentId="${shipResult.shipmentId}"
                productId="DEMO_3_1" orderId="${cartOrderId}" orderItemSeqId="02" statusId="SisPacked" quantity="5"
                invoiceId="55500" invoiceItemSeqId="02"/>
            <mantle.shipment.ShipmentPackageContent shipmentId="${shipResult.shipmentId}" shipmentPackageSeqId="02"
                productId="DEMO_3_1" quantity="5"/>

            <mantle.shipment.ShipmentItem shipmentId="${shipResult.shipmentId}" productId="DEMO_2_1" quantity="7"/>
            <mantle.shipment.ShipmentItemSource shipmentItemSourceId="55502" shipmentId="${shipResult.shipmentId}"
                productId="DEMO_2_1" orderId="${cartOrderId}" orderItemSeqId="03" statusId="SisPacked" quantity="7"
                invoiceId="55500" invoiceItemSeqId="03"/>
            <mantle.shipment.ShipmentPackageContent shipmentId="${shipResult.shipmentId}" shipmentPackageSeqId="03"
                productId="DEMO_2_1" quantity="7"/>

            <mantle.shipment.ShipmentRouteSegment shipmentId="${shipResult.shipmentId}" shipmentRouteSegmentSeqId="01"
                destPostalContactMechId="CustJqpAddr" destTelecomContactMechId="CustJqpTeln"/>
            <mantle.shipment.ShipmentPackageRouteSeg shipmentId="${shipResult.shipmentId}" shipmentPackageSeqId="01"
                shipmentRouteSegmentSeqId="01"/>
        </entity-facade-xml>""").check()
        logger.info("ship Sales Order data check results: " + dataCheckErrors)

        then:
        dataCheckErrors.size() == 0
    }

    def "validate Sales Order Complete"() {
        when:
        // NOTE: this has sequenced IDs so is sensitive to run order!
        List<String> dataCheckErrors = ec.entity.makeDataLoader().xmlText("""<entity-facade-xml>
            <!-- OrderHeader status to Completed -->
            <mantle.order.OrderHeader orderId="${cartOrderId}" entryDate="${effectiveTime}" placedDate="${effectiveTime}"
                statusId="OrderCompleted" currencyUomId="USD" productStoreId="POPC_DEFAULT" grandTotal="${kieEnabled ? '145.68' : '140.68'}"/>
        </entity-facade-xml>""").check()
        logger.info("validate Sales Order Complete data check results: " + dataCheckErrors)

        then:
        dataCheckErrors.size() == 0
    }

    def "validate Asset Issuance"() {
        when:
        // NOTE: this has sequenced IDs so is sensitive to run order!
        List<String> dataCheckErrors = ec.entity.makeDataLoader().xmlText("""<entity-facade-xml>
            <!-- Asset created, issued, change recorded in detail -->

            <mantle.product.asset.Asset assetId="55400" quantityOnHandTotal="399" availableToPromiseTotal="199"/>
            <mantle.product.issuance.AssetIssuance assetIssuanceId="55500" assetId="55400" orderId="${cartOrderId}"
                orderItemSeqId="01" issuedDate="${effectiveTime}" quantity="1" productId="DEMO_1_1"
                assetReservationId="55500" shipmentId="${shipResult.shipmentId}"/>
            <mantle.product.asset.AssetDetail assetDetailId="55503" assetId="55400" effectiveDate="${effectiveTime}"
                quantityOnHandDiff="-1" assetReservationId="55500" shipmentId="${shipResult.shipmentId}"
                productId="DEMO_1_1" assetIssuanceId="55500"/>

            <mantle.product.asset.Asset assetId="DEMO_3_1A" quantityOnHandTotal="0" availableToPromiseTotal="0"/>
            <mantle.product.issuance.AssetIssuance assetIssuanceId="55501" assetId="DEMO_3_1A" assetReservationId="55501"
                orderId="${cartOrderId}" orderItemSeqId="02" shipmentId="${shipResult.shipmentId}" productId="DEMO_3_1"
                quantity="5"/>
            <mantle.product.asset.AssetDetail assetDetailId="55504" assetId="DEMO_3_1A" effectiveDate="${effectiveTime}"
                quantityOnHandDiff="-5" assetReservationId="55501" shipmentId="${shipResult.shipmentId}"
                productId="DEMO_3_1" assetIssuanceId="55501"/>

            <!-- this is an auto-created Asset based on the inventory issuance -->
            <mantle.product.asset.Asset assetId="55500" quantityOnHandTotal="0" availableToPromiseTotal="0"/>
            <mantle.product.issuance.AssetIssuance assetIssuanceId="55502" assetId="55500" assetReservationId="55502"
                orderId="${cartOrderId}" orderItemSeqId="03" shipmentId="${shipResult.shipmentId}" productId="DEMO_2_1"
                quantity="7"/>
            <mantle.product.asset.AssetDetail assetDetailId="55505" assetId="55500" effectiveDate="${effectiveTime}"
                quantityOnHandDiff="-7" assetReservationId="55502" shipmentId="${shipResult.shipmentId}"
                productId="DEMO_2_1" assetIssuanceId="55502"/>
            <!-- the automatic physical inventory found record because QOH went below zero -->
            <mantle.product.asset.AssetDetail assetDetailId="55506" assetId="55500" physicalInventoryId="55500"
                availableToPromiseDiff="7" quantityOnHandDiff="7" productId="DEMO_2_1" varianceReasonEnumId="InVrFound"
                acctgTransResultEnumId="AtrNoAcquireCost"/>
        </entity-facade-xml>""").check()
        logger.info("validate Asset Issuance data check results: ")
        for (String dataCheckError in dataCheckErrors) logger.info(dataCheckError)

        then:
        dataCheckErrors.size() == 0
    }

    def "validate Asset Issuance Accounting Transactions"() {
        when:
        // NOTE: this has sequenced IDs so is sensitive to run order!
        List<String> dataCheckErrors = ec.entity.makeDataLoader().xmlText("""<entity-facade-xml>
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
                amount="20" glAccountTypeEnumId="GatInventory" glAccountId="141300000"
                reconcileStatusId="AterNot" isSummary="N" productId="DEMO_3_1"/>
            <mantle.ledger.transaction.AcctgTransEntry acctgTransId="55501" acctgTransEntrySeqId="02" debitCreditFlag="D"
                amount="20" glAccountTypeEnumId="GatCogs" glAccountId="512000000"
                reconcileStatusId="AterNot" isSummary="N" productId="DEMO_3_1"/>

            <!-- NOTE: there is no AcctgTrans for assetId 55500, productId DEMO_2_1 because it is auto-created and has
                no acquireCost. -->
        </entity-facade-xml>""").check()
        logger.info("validate Shipment Invoice Accounting Transaction data check results: ")
        for (String dataCheckError in dataCheckErrors) logger.info(dataCheckError)

        then:
        dataCheckErrors.size() == 0
    }

    def "validate Shipment Invoice"() {
        when:
        // NOTE: this has sequenced IDs so is sensitive to run order!
        List<String> dataCheckErrors = ec.entity.makeDataLoader().xmlText("""<entity-facade-xml>
            <!-- Invoice created and Finalized (status set by action in SECA rule), then Payment Received (status set by Payment application) -->
            <mantle.account.invoice.Invoice invoiceId="55500" invoiceTypeEnumId="InvoiceSales"
                fromPartyId="ORG_ZIZI_RETAIL" toPartyId="CustJqp" statusId="InvoicePmtRecvd" invoiceDate="${effectiveTime}"
                description="For Order ${cartOrderId} part 01 and Shipment ${shipResult.shipmentId}" currencyUomId="USD"/>

            <mantle.account.invoice.InvoiceItem invoiceId="55500" invoiceItemSeqId="01" itemTypeEnumId="ItemProduct"
                productId="DEMO_1_1" quantity="1" amount="16.99" description="Demo Product One-One" itemDate="${effectiveTime}"/>
            <mantle.order.OrderItemBilling orderItemBillingId="55500" orderId="${cartOrderId}" orderItemSeqId="01"
                invoiceId="55500" invoiceItemSeqId="01" assetIssuanceId="55500" shipmentId="${shipResult.shipmentId}"
                quantity="1" amount="16.99"/>

            <mantle.account.invoice.InvoiceItem invoiceId="55500" invoiceItemSeqId="02" itemTypeEnumId="ItemProduct"
                productId="DEMO_3_1" quantity="5" amount="7.77" description="Demo Product Three-One" itemDate="${effectiveTime}"/>
            <mantle.order.OrderItemBilling orderItemBillingId="55501" orderId="${cartOrderId}" orderItemSeqId="02"
                invoiceId="55500" invoiceItemSeqId="02" assetIssuanceId="55501" shipmentId="${shipResult.shipmentId}"
                quantity="5" amount="7.77"/>

            <mantle.account.invoice.InvoiceItem invoiceId="55500" invoiceItemSeqId="03" itemTypeEnumId="ItemProduct"
                productId="DEMO_2_1" quantity="7" amount="12.12" description="Demo Product Two-One" itemDate="${effectiveTime}"/>
            <mantle.order.OrderItemBilling orderItemBillingId="55502" orderId="${cartOrderId}" orderItemSeqId="03"
                invoiceId="55500" invoiceItemSeqId="03" assetIssuanceId="55502" shipmentId="${shipResult.shipmentId}"
                quantity="7" amount="12.12"/>
        </entity-facade-xml>""").check()
        if (kieEnabled) {
            dataCheckErrors += ec.entity.makeDataLoader().xmlText("""<entity-facade-xml>
                <mantle.account.invoice.InvoiceItem invoiceId="55500" invoiceItemSeqId="04" itemTypeEnumId="ItemShipping"
                    quantity="1" amount="5" description="Ground Parcel" itemDate="${effectiveTime}"/>
                <mantle.order.OrderItemBilling orderItemBillingId="55503" orderId="${cartOrderId}" orderItemSeqId="04"
                    invoiceId="55500" invoiceItemSeqId="04" shipmentId="${shipResult.shipmentId}" quantity="1" amount="${kieEnabled ? '5' : '0'}"/>
            </entity-facade-xml>""").check()
        }
        logger.info("validate Shipment Invoice data check results: " + dataCheckErrors)

        then:
        dataCheckErrors.size() == 0
    }

    def "validate Shipment Invoice Accounting Transaction"() {
        when:
        // NOTE: this has sequenced IDs so is sensitive to run order!
        List<String> dataCheckErrors = ec.entity.makeDataLoader().xmlText("""<entity-facade-xml>
            <!-- AcctgTrans created for Finalized Invoice -->
            <mantle.ledger.transaction.AcctgTrans acctgTransId="55502" acctgTransTypeEnumId="AttSalesInvoice"
                organizationPartyId="ORG_ZIZI_RETAIL" transactionDate="${effectiveTime}" isPosted="Y"
                postedDate="${effectiveTime}" glFiscalTypeEnumId="GLFT_ACTUAL" amountUomId="USD" otherPartyId="CustJqp"
                invoiceId="55500"/>
            <mantle.ledger.transaction.AcctgTransEntry acctgTransId="55502" acctgTransEntrySeqId="01" debitCreditFlag="C"
                amount="16.99" glAccountId="411000000" reconcileStatusId="AterNot" isSummary="N"
                productId="DEMO_1_1" invoiceItemSeqId="01"/>
            <mantle.ledger.transaction.AcctgTransEntry acctgTransId="55502" acctgTransEntrySeqId="02" debitCreditFlag="C"
                amount="38.85" glAccountId="411000000" reconcileStatusId="AterNot" isSummary="N"
                productId="DEMO_3_1" invoiceItemSeqId="02"/>
            <mantle.ledger.transaction.AcctgTransEntry acctgTransId="55502" acctgTransEntrySeqId="03" debitCreditFlag="C"
                amount="84.84" glAccountId="411000000" reconcileStatusId="AterNot" isSummary="N"
                productId="DEMO_2_1" invoiceItemSeqId="03"/>
            <!-- <mantle.ledger.transaction.AcctgTransEntry acctgTransId="55502" acctgTransEntrySeqId="04" debitCreditFlag="C"
                amount="5" glAccountId="441000000" reconcileStatusId="AterNot" isSummary="N" invoiceItemSeqId="04"/> -->
            <mantle.ledger.transaction.AcctgTransEntry acctgTransId="55502" acctgTransEntrySeqId="${kieEnabled ? '05' : '04'}" debitCreditFlag="D"
                amount="${kieEnabled ? '145.68' : '140.68'}" glAccountTypeEnumId="GatAccountsReceivable" glAccountId="121000000"
                reconcileStatusId="AterNot" isSummary="N"/>
        </entity-facade-xml>""").check()
        logger.info("validate Shipment Invoice Accounting Transaction data check results: ")
        for (String dataCheckError in dataCheckErrors) logger.info(dataCheckError)

        then:
        dataCheckErrors.size() == 0
    }

    def "validate Payment Accounting Transaction"() {
        when:
        // NOTE: this has sequenced IDs so is sensitive to run order!
        List<String> dataCheckErrors = ec.entity.makeDataLoader().xmlText("""<entity-facade-xml>
            <mantle.account.payment.Payment paymentId="${setInfoOut.paymentId}" statusId="PmntDelivered"/>
            <mantle.account.payment.PaymentApplication paymentApplicationId="55500" paymentId="${setInfoOut.paymentId}"
                invoiceId="55500" amountApplied="${kieEnabled ? '145.68' : '140.68'}" appliedDate="${effectiveTime}"/>
            <mantle.account.method.PaymentGatewayResponse paymentGatewayResponseId="55501"
                paymentOperationEnumId="PgoCapture"
                paymentId="${setInfoOut.paymentId}" paymentMethodId="CustJqpCc" amount="${kieEnabled ? '145.68' : '140.68'}" amountUomId="USD"
                transactionDate="${effectiveTime}" resultSuccess="Y" resultDeclined="N" resultNsf="N"
                resultBadExpire="N" resultBadCardNumber="N"/>
            <!-- don't validate these, allow any payment gateway: paymentGatewayConfigId="TEST_APPROVE" referenceNum="TEST" -->

            <mantle.ledger.transaction.AcctgTrans acctgTransId="55503" acctgTransTypeEnumId="AttIncomingPayment"
                organizationPartyId="ORG_ZIZI_RETAIL" transactionDate="${effectiveTime}" isPosted="Y"
                glFiscalTypeEnumId="GLFT_ACTUAL" amountUomId="USD" otherPartyId="CustJqp"
                paymentId="${setInfoOut.paymentId}"/>
            <mantle.ledger.transaction.AcctgTransEntry acctgTransId="55503" acctgTransEntrySeqId="01" debitCreditFlag="C"
                amount="${kieEnabled ? '145.68' : '140.68'}" glAccountId="121000000" reconcileStatusId="AterNot" isSummary="N"/>
            <mantle.ledger.transaction.AcctgTransEntry acctgTransId="55503" acctgTransEntrySeqId="02" debitCreditFlag="D"
                amount="${kieEnabled ? '145.68' : '140.68'}" glAccountId="111100000" reconcileStatusId="AterNot" isSummary="N"/>
        </entity-facade-xml>""").check()
        logger.info("validate Payment Accounting Transaction data check results: ")
        for (String dataCheckError in dataCheckErrors) logger.info(dataCheckError)

        then:
        dataCheckErrors.size() == 0
    }
}
