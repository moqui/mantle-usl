// Payment gateway operations on a single payment: authorize, release, capture, refund, gateway details polling, the
// local test gateway services, and cancelling a payment with its invoices. New spec, no Groovy original.
const effectiveTime = Date.now()
const vendorId = "ORG_ZIZI_RETAIL"
let customerId, cardId, paymentId, secondPaymentId, refundId, invoiceId, promisedId

spec({
    stepwise: true,
    tempSequences: { start: 58600, banks: { "mantle.party.Party": 10, "mantle.account.payment.Payment": 30, "mantle.account.method.PaymentMethod": 10,
        "mantle.account.method.PaymentGatewayResponse": 30, "mantle.account.invoice.Invoice": 10, "mantle.ledger.transaction.AcctgTrans": 60 } },
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(effectiveTime)
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

const n = (value) => dec(value).toNumber()
function errorOf(name, params) {
    try { call(name, params) } catch (e) { ec.message.clearErrors(); return String(e.message) }
    return null
}
const payment = (id) => ec.entity.find("mantle.account.payment.Payment").condition("paymentId", id).one()
const responses = (id) => Array.from(ec.entity.find("mantle.account.method.PaymentGatewayResponse").condition("paymentId", id).orderBy("paymentGatewayResponseId").list())
function cardPayment(amount, extra) {
    return call("mantle.account.PaymentServices.create#Payment", Object.assign({ fromPartyId: customerId, toPartyId: vendorId, amount, amountUomId: "USD", paymentMethodId: cardId,
            paymentInstrumentEnumId: "PiCreditCard", statusId: "PmntPromised", effectiveDate: effectiveTime - 3600000 }, extra)).paymentId
}

feature("a customer with a credit card and a promised payment", {
    when() {
        customerId = call("mantle.party.PartyServices.create#Person", { firstName: "Gary", lastName: "Gateway", roleTypeId: "Customer" }).partyId
        cardId = call("mantle.account.PaymentMethodServices.store#PaymentMethodInfo", { partyId: customerId, paymentMethodTypeEnumId: "PmtCreditCard",
                creditCardTypeEnumId: "CctVisa", cardNumber: "4111111111111111", expireMonth: "12", expireYear: String(new Date(effectiveTime).getUTCFullYear() + 3),
                firstNameOnAccount: "Gary", lastNameOnAccount: "Gateway", address1: "1 Gate St", city: "Orem", stateProvinceGeoId: "USA_UT", postalCode: "84057",
                countryGeoId: "USA" }).paymentMethodId
        paymentId = cardPayment(100)
        return { ids: [customerId, cardId, paymentId] }
    },
    then({ ids }) { ids.every(id => id != null) },
})

feature("authorize with the always-approve test gateway, then release back to promised", {
    when() {
        const auth = call("mantle.account.PaymentServices.authorize#SinglePayment", { paymentId, paymentGatewayConfigId: "TEST_APPROVE" })
        const authorized = payment(paymentId)
        const lookup = call("mantle.account.PaymentServices.get#AuthorizePaymentGatewayResponse", { paymentId })
        // releasing a payment not authorized is refused
        const released = call("mantle.account.PaymentServices.release#SinglePayment", { paymentId })
        const afterRelease = payment(paymentId)
        const missing = call("mantle.account.PaymentServices.release#SinglePayment", { paymentId: "NO_SUCH_PAYMENT" })
        return { auth, authorized, lookup, released, afterRelease, missing }
    },
    then({ auth, authorized, lookup, released, afterRelease }) {
        auth.paymentGatewayResponse.resultSuccess == "Y"
        authorized.statusId == "PmntAuthorized"
        authorized.paymentGatewayConfigId == "TEST_APPROVE"
        lookup.paymentGatewayResponse.paymentGatewayResponseId == auth.paymentGatewayResponseId
        released.paymentGatewayResponseId != null
        afterRelease.statusId == "PmntPromised"
        afterRelease.paymentAuthCode == null
    },
})

feature("a delivered payment cannot be released but can be refunded, and refunds are limited to its amount", {
    when() {
        call("mantle.account.PaymentServices.authorize#SinglePayment", { paymentId, paymentGatewayConfigId: "TEST_APPROVE" })
        const captured = call("mantle.account.PaymentServices.capture#SinglePayment", { paymentId })
        const delivered = payment(paymentId)
        const releaseRefused = errorOf("mantle.account.PaymentServices.release#SinglePayment", { paymentId })
        const tooMuch = errorOf("mantle.account.PaymentServices.refund#SinglePayment", { paymentId, amount: 150 })
        const refund = call("mantle.account.PaymentServices.refund#SinglePayment", { paymentId, amount: 40 })
        refundId = refund.refundPaymentId
        const second = call("mantle.account.PaymentServices.refund#SinglePayment", { paymentId, amount: 60 })
        return { captured, delivered, releaseRefused, tooMuch, refund, second, refundPayment: payment(refundId) }
    },
    then({ captured, delivered, releaseRefused, tooMuch, refund, second, refundPayment }) {
        captured.paymentGatewayResponse.resultSuccess == "Y"
        delivered.statusId == "PmntDelivered"
        releaseRefused.includes("try a refund instead")
        tooMuch.includes("greater than refundable amount")
        refundId != null
        n(refundPayment.amount) == 40
        refundPayment.statusId == "PmntDelivered"
        refundPayment.refundForPaymentId == paymentId
        second.refundPaymentId != refundId
    },
})

feature("the always-decline and failure test gateways", {
    when() {
        secondPaymentId = cardPayment(25)
        const declined = call("mantle.account.PaymentServices.authorize#SinglePayment", { paymentId: secondPaymentId, paymentGatewayConfigId: "TEST_DECLINE" })
        const afterDecline = payment(secondPaymentId).statusId
        // the individual test services record what they are named for
        const results = {}
        for (const name of ["alwaysBadCardNumber", "alwaysBadExpire", "alwaysNsf", "alwaysDecline"]) {
            const out = call("mantle.account.PaymentTestServices." + name + "#PaymentAuthorization", { paymentId: secondPaymentId, paymentGatewayConfigId: "TEST_DECLINE" })
            results[name] = ec.entity.find("mantle.account.method.PaymentGatewayResponse").condition("paymentGatewayResponseId", out.paymentGatewayResponseId).one()
        }
        const fail = call("mantle.account.PaymentTestServices.alwaysFail#PaymentAuthorization", { paymentId: secondPaymentId, paymentGatewayConfigId: "TEST_DECLINE" })
        const decCapture = call("mantle.account.PaymentTestServices.alwaysDecline#PaymentCapture", { paymentId: secondPaymentId, paymentGatewayConfigId: "TEST_DECLINE" })
        const decCaptureResp = ec.entity.find("mantle.account.method.PaymentGatewayResponse").condition("paymentGatewayResponseId", decCapture.paymentGatewayResponseId).one()
        return { declined, afterDecline, results, fail, decCaptureResp }
    },
    then({ declined, afterDecline, results, decCaptureResp }) {
        declined.paymentGatewayResponse.resultDeclined == "Y"
        afterDecline != "PmntDelivered"
        results.alwaysBadCardNumber.resultBadCardNumber == "Y"
        results.alwaysBadExpire.resultBadExpire == "Y"
        results.alwaysNsf.resultNsf == "Y"
        results.alwaysDecline.resultDeclined == "Y"
        decCaptureResp.resultSuccess == "N"
        decCaptureResp.paymentOperationEnumId == "PgoCapture"
    },
})

feature("direct release and refund test gateway services", {
    when() {
        const release = call("mantle.account.PaymentTestServices.alwaysApprove#PaymentRelease", { paymentId, paymentGatewayConfigId: "TEST_APPROVE" })
        const refund = call("mantle.account.PaymentTestServices.alwaysApprove#PaymentRefund", { paymentId, paymentGatewayConfigId: "TEST_APPROVE" })
        const resp = (id) => ec.entity.find("mantle.account.method.PaymentGatewayResponse").condition("paymentGatewayResponseId", id).one()
        return { release: resp(release.paymentGatewayResponseId), refund: resp(refund.paymentGatewayResponseId) }
    },
    then({ release, refund }) {
        release.paymentOperationEnumId == "PgoRelease"
        release.resultSuccess == "Y"
        refund.paymentOperationEnumId == "PgoRefund"
        refund.resultSuccess == "Y"
    },
})

feature("gateway details for a payment without a details service, and the polling job", {
    when() {
        call("update#mantle.account.payment.Payment", { paymentId, paymentRefNum: "TESTREF" })
        const details = call("mantle.account.PaymentServices.get#SinglePaymentGatewayDetails", { paymentId })
        const noRef = call("mantle.account.PaymentServices.get#SinglePaymentGatewayDetails", { paymentId: secondPaymentId })
        const missing = call("mantle.account.PaymentServices.get#SinglePaymentGatewayDetails", { paymentId: "NO_SUCH_PAYMENT" })
        const poll = call("mantle.account.PaymentServices.poll#PaymentGatewayDetails", { lookBackDays: 30 })
        return { details, noRef, missing, poll }
    },
    then({ details }) {
        details.paymentGatewayResponseId == null
    },
})

feature("send a promised payment to an invoice, then capture it through the deprecated invoice services", {
    when() {
        invoiceId = call("mantle.account.InvoiceServices.create#Invoice", { fromPartyId: vendorId, toPartyId: customerId, invoiceTypeEnumId: "InvoiceSales",
                invoiceDate: effectiveTime - 7200000, currencyUomId: "USD" }).invoiceId
        call("mantle.account.InvoiceServices.create#InvoiceItem", { invoiceId, itemTypeEnumId: "ItemProduct", description: "Gateway item", quantity: 1, amount: 60 })
        call("update#mantle.account.invoice.Invoice", { invoiceId, statusId: "InvoiceFinalized" })
        promisedId = cardPayment(60)
        call("mantle.account.PaymentServices.authorize#SinglePayment", { paymentId: promisedId, paymentGatewayConfigId: "TEST_APPROVE" })
        const sent = call("mantle.account.PaymentServices.send#PromisedPayment", { paymentId: promisedId, invoiceId, paymentRefNum: "SENT1" })
        const captured = call("mantle.account.PaymentServices.capture#InvoicePayments", { invoiceId })
        const apps = Array.from(ec.entity.find("mantle.account.payment.PaymentApplication").condition("paymentId", promisedId).list())
        const capturedApplied = call("mantle.account.PaymentServices.capture#AppliedPayment", { paymentApplicationId: apps[0].paymentApplicationId })
        return { sent, captured, apps, capturedApplied, p: payment(promisedId) }
    },
    then({ sent, captured, apps, p }) {
        sent.paymentApplicationId != null
        n(sent.amountApplied) == 60
        captured.captureFailed == false
        apps.length == 1
        p.statusId == "PmntDelivered"
        p.paymentRefNum == "SENT1"
    },
})

feature("cancel a payment and its invoices", {
    when() {
        const newPayment = cardPayment(15)
        const otherInvoice = call("mantle.account.InvoiceServices.create#Invoice", { fromPartyId: vendorId, toPartyId: customerId, invoiceTypeEnumId: "InvoiceSales",
                invoiceDate: effectiveTime - 7200000, currencyUomId: "USD" }).invoiceId
        call("update#mantle.account.payment.Payment", { paymentId: newPayment, forInvoiceId: otherInvoice })
        call("mantle.account.PaymentServices.cancel#PaymentAndInvoices", { paymentId: newPayment })
        const refused = errorOf("mantle.account.PaymentServices.cancel#PaymentAndInvoices", { paymentId: newPayment })
        // a delivered payment is voided instead
        call("mantle.account.PaymentServices.cancel#PaymentAndInvoices", { paymentId: refundId })
        return { refused, voided: payment(refundId), cancelled: payment(newPayment), invoice: ec.entity.find("mantle.account.invoice.Invoice").condition("invoiceId", otherInvoice).one() }
    },
    then({ refused, voided, cancelled, invoice }) {
        refused.includes("must be in Proposed or Promised status")
        voided.statusId == "PmntVoid"
        cancelled.statusId == "PmntCancelled"
        invoice.statusId == "InvoiceCancelled"
    },
})
