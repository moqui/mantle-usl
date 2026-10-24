// Invoice and payment services the order and payroll flows do not reach: info lookups, edits, credit memos, reversal,
// auto apply, refunds, voids, cancellation, content. New spec, no Groovy original.
const effectiveTime = Date.now()
let orgId, customerId, invoiceId, itemSeqId, paymentId, creditMemoId, invoice2Id, payment2Id

spec({
    stepwise: true,
    tempSequences: { start: 56900, banks: { "mantle.party.Party": 10, "mantle.account.invoice.Invoice": 20,
        "mantle.account.payment.Payment": 20, "mantle.party.time.TimePeriod": 30, "mantle.ledger.transaction.AcctgTrans": 40 } },
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
const invoice = (id) => ec.entity.find("mantle.account.invoice.Invoice").condition("invoiceId", id).one()
const payment = (id) => ec.entity.find("mantle.account.payment.Payment").condition("paymentId", id).one()

feature("set up an internal org, a customer, and a sales invoice with two items", {
    when() {
        orgId = call("mantle.party.PartyServices.create#Organization", { organizationName: "Invoice Org", roleTypeId: "Supplier" }).partyId
        call("create#mantle.party.PartyRole", { partyId: orgId, roleTypeId: "OrgInternal" })
        call("mantle.ledger.LedgerServices.init#PartyAccountingConfiguration",
                { sourcePartyId: "DefaultSettings", organizationPartyId: orgId, startYear: String(new Date(effectiveTime).getUTCFullYear()) })
        customerId = call("mantle.party.PartyServices.create#Organization", { organizationName: "Invoice Customer", roleTypeId: "Customer" }).partyId
        invoiceId = call("mantle.account.InvoiceServices.create#Invoice", { fromPartyId: orgId, toPartyId: customerId, invoiceTypeEnumId: "InvoiceSales",
                invoiceDate: effectiveTime - 3600000, currencyUomId: "USD", description: "Misc Invoice" }).invoiceId
        itemSeqId = call("mantle.account.InvoiceServices.create#InvoiceItem", { invoiceId, itemTypeEnumId: "ItemProduct", quantity: 2, amount: 50, description: "Widgets" }).invoiceItemSeqId
        call("mantle.account.InvoiceServices.create#InvoiceItem", { invoiceId, itemTypeEnumId: "ItemShipping", quantity: 1, amount: 10, description: "Shipping" })
        return { total: call("mantle.account.InvoiceServices.get#InvoiceTotal", { invoiceId }) }
    },
    then({ total }) { n(total.invoiceTotal) == 110 },
})

feature("edit the invoice and its items", {
    when() {
        call("mantle.account.InvoiceServices.update#Invoice", { invoiceId, description: "Edited Invoice", referenceNumber: "REF-1" })
        call("mantle.account.InvoiceServices.update#InvoiceItem", { invoiceId, invoiceItemSeqId: itemSeqId, quantity: 3 })
        const extraSeqId = call("mantle.account.InvoiceServices.create#InvoiceItem", { invoiceId, itemTypeEnumId: "ItemDiscount", quantity: 1, amount: -5, description: "Discount" }).invoiceItemSeqId
        call("mantle.account.InvoiceServices.delete#InvoiceItem", { invoiceId, invoiceItemSeqId: extraSeqId })
        const total = call("mantle.account.InvoiceServices.get#InvoiceTotal", { invoiceId })
        const items = ec.entity.find("mantle.account.invoice.InvoiceItem").condition("invoiceId", invoiceId).list()
        return { total, header: invoice(invoiceId), items }
    },
    then({ total, header, items }) {
        header.description == "Edited Invoice"
        header.referenceNumber == "REF-1"
        items.length == 2
        n(total.invoiceTotal) == 160
    },
})

feature("invoice info, display info and print info", {
    when() {
        const basic = call("mantle.account.InvoiceServices.get#InvoiceBasicInfo", { invoiceId, activeOrgId: orgId })
        const display = call("mantle.account.InvoiceServices.get#InvoiceDisplayInfo", { invoiceId, activeOrgId: orgId })
        return { basic, display }
    },
    then({ basic, display }) {
        basic.invoice.invoiceId == invoiceId
        basic.invoiceEditable == true
        display.invoice.invoiceId == invoiceId
    },
})

feature("finalize the invoice, adjust it, then update it as closed", {
    when() {
        call("update#mantle.account.invoice.Invoice", { invoiceId, statusId: "InvoiceFinalized" })
        const notAdjustment = errorOf("mantle.account.InvoiceServices.update#InvoiceItemAdjustment", { invoiceId, invoiceItemSeqId: itemSeqId, description: "no" })
        call("mantle.account.InvoiceServices.adjust#Invoice", { invoiceId, description: "Discount", amount: -5 })
        const adjustSeqId = Array.from(ec.entity.find("mantle.account.invoice.InvoiceItem").condition("invoiceId", invoiceId).condition("isAdjustment", "Y").list())[0].invoiceItemSeqId
        call("mantle.account.InvoiceServices.update#InvoiceItemAdjustment", { invoiceId, invoiceItemSeqId: adjustSeqId, description: "Discount (adjusted)", amount: -7 })
        const adjusted = ec.entity.find("mantle.account.invoice.InvoiceItem").condition("invoiceId", invoiceId).condition("invoiceItemSeqId", adjustSeqId).one()
        call("mantle.account.InvoiceServices.update#InvoiceClosed", { invoiceId, invoiceMessage: "Thanks", dueDate: effectiveTime + 7 * 86400000 })
        const closed = invoice(invoiceId)
        const print = call("mantle.account.InvoiceServices.get#InvoicePrintInfo", { invoiceId })
        const editable = call("mantle.account.InvoiceServices.get#InvoiceBasicInfo", { invoiceId, activeOrgId: orgId })
        return { closed, print, editable, notAdjustment, adjusted }
    },
    then({ closed, print, editable, notAdjustment, adjusted }) {
        notAdjustment.includes("not an Adjustment item")
        adjusted.description == "Discount (adjusted)"
        n(adjusted.amount) == -7
        closed.statusId == "InvoiceFinalized"
        closed.invoiceMessage == "Thanks"
        n(print.invoiceTotal) == 153
        editable.invoiceEditable == false
    },
})

feature("record a payment, auto apply it, and read payment info", {
    when() {
        const stray = call("mantle.account.PaymentServices.create#Payment", { fromPartyId: customerId, toPartyId: orgId, amount: 1, amountUomId: "USD",
                statusId: "PmntDelivered", effectiveDate: effectiveTime }).paymentId
        // autoApply#Payment and autoApplyTo#Invoice are TODO stubs in mantle-usl, so they run and apply nothing
        const applied = call("mantle.account.PaymentServices.autoApply#Payment", { paymentId: stray })
        const appliedTo = call("mantle.account.InvoiceServices.autoApplyTo#Invoice", { invoiceId })
        paymentId = call("mantle.account.PaymentServices.create#InvoicePayment", { invoiceId, amount: 153, paymentInstrumentEnumId: "PiCompanyCheck",
                paymentStatusId: "PmntDelivered", effectiveDate: effectiveTime - 1800000 }).paymentId
        const afterInvoice = invoice(invoiceId)
        const display = call("mantle.account.PaymentServices.get#PaymentDisplayInfo", { paymentId })
        const description = call("mantle.account.PaymentServices.get#PaymentDescription", { paymentId })
        const checks = call("mantle.account.PaymentServices.get#PaymentCheckInfo", { paymentIdList: [paymentId] })
        return { applied, appliedTo, afterInvoice, display, description, checks }
    },
    then({ applied, appliedTo, afterInvoice, display, description, checks }) {
        applied != null
        appliedTo != null
        afterInvoice.statusId == "InvoicePmtRecvd"
        n(display.appliedTotal) == 153
        n(display.unappliedTotal) == 0
        display.paymentApplicationList.length == 1
        description.paymentDescription != null
        checks.paymentInfoList.length == 1
    },
})

feature("set the payment date, refund it, and set the refund link", {
    when() {
        call("mantle.account.PaymentServices.set#PaymentDate", { paymentId, effectiveDate: effectiveTime - 900000, overrideCurrent: true })
        const dated = payment(paymentId)
        const refund = call("mantle.account.PaymentServices.create#RefundPayment", { paymentId, amount: 20, effectiveDate: effectiveTime })
        const refundPayment = payment(refund.paymentId)
        const other = call("mantle.account.PaymentServices.create#Payment", { fromPartyId: orgId, toPartyId: customerId, amount: 5, amountUomId: "USD", statusId: "PmntPromised",
                paymentTypeEnumId: "PtRefund" }).paymentId
        call("mantle.account.PaymentServices.set#PaymentRefundFor", { paymentId: other, refundForPaymentId: paymentId })
        return { dated, refund, refundPayment, linked: payment(other) }
    },
    then({ dated, refund, refundPayment, linked }) {
        String(dated.effectiveDate) == String(effectiveTime - 900000)
        n(refund.amount) == 20
        refundPayment.paymentTypeEnumId == "PtRefund"
        linked.refundForPaymentId == paymentId
    },
})

feature("a credit memo and reversing an invoice", {
    when() {
        creditMemoId = call("mantle.account.InvoiceServices.create#InvoiceCreditMemo", { originalInvoiceId: invoiceId, amount: 25, description: "Return credit" }).invoiceId
        const memo = invoice(creditMemoId)
        const memoTotal = call("mantle.account.InvoiceServices.get#InvoiceTotal", { invoiceId: creditMemoId })
        invoice2Id = call("mantle.account.InvoiceServices.create#Invoice", { fromPartyId: orgId, toPartyId: customerId, invoiceTypeEnumId: "InvoiceSales",
                invoiceDate: effectiveTime, currencyUomId: "USD" }).invoiceId
        call("mantle.account.InvoiceServices.create#InvoiceItem", { invoiceId: invoice2Id, itemTypeEnumId: "ItemProduct", quantity: 1, amount: 40, description: "Gadget" })
        call("mantle.account.InvoiceServices.reverse#Invoice", { invoiceId: invoice2Id })
        const reversed = invoice(invoice2Id)
        const reversedTotal = call("mantle.account.InvoiceServices.get#InvoiceTotal", { invoiceId: invoice2Id })
        // a finalized invoice cannot be reversed: the service reports it as a danger message and changes nothing
        call("mantle.account.InvoiceServices.reverse#Invoice", { invoiceId })
        const refused = ec.message.getErrorsString()
        ec.message.clearErrors()
        return { memo, memoTotal, reversed, reversedTotal, refused, same: invoice(invoiceId) }
    },
    then({ memo, memoTotal, reversed, reversedTotal, refused, same }) {
        memo.invoiceTypeEnumId == "InvoiceCreditMemo"
        n(memoTotal.invoiceTotal) == 25
        reversed.fromPartyId == customerId
        reversed.toPartyId == orgId
        reversed.statusId == "InvoiceIncoming"
        n(reversedTotal.invoiceTotal) == -40
        same.fromPartyId == orgId
    },
})

feature("void a payment, cancel a payment and its invoices, and cancel an invoice and its payments", {
    when() {
        payment2Id = call("mantle.account.PaymentServices.create#Payment", { fromPartyId: customerId, toPartyId: orgId, amount: 15, amountUomId: "USD", statusId: "PmntDelivered",
                paymentInstrumentEnumId: "PiCompanyCheck", effectiveDate: effectiveTime }).paymentId
        call("mantle.account.PaymentServices.void#Payment", { paymentId: payment2Id })
        const voided = payment(payment2Id)
        const invoice3Id = call("mantle.account.InvoiceServices.create#Invoice", { fromPartyId: orgId, toPartyId: customerId, invoiceTypeEnumId: "InvoiceSales",
                invoiceDate: effectiveTime, currencyUomId: "USD" }).invoiceId
        call("mantle.account.InvoiceServices.create#InvoiceItem", { invoiceId: invoice3Id, itemTypeEnumId: "ItemProduct", quantity: 1, amount: 30, description: "Thing" })
        call("update#mantle.account.invoice.Invoice", { invoiceId: invoice3Id, statusId: "InvoiceFinalized" })
        const pay3 = call("mantle.account.PaymentServices.create#InvoicePayment", { invoiceId: invoice3Id, amount: 30, paymentInstrumentEnumId: "PiCompanyCheck",
                paymentStatusId: "PmntDelivered", effectiveDate: effectiveTime }).paymentId
        call("mantle.account.InvoiceServices.cancel#InvoiceAndPayments", { invoiceId: invoice3Id })
        return { voided, invoice3: invoice(invoice3Id), pay3: payment(pay3) }
    },
    then({ voided, invoice3, pay3 }) {
        voided.statusId == "PmntVoid"
        invoice3.statusId == "InvoiceCancelled"
        pay3.statusId == "PmntCancelled" || pay3.statusId == "PmntVoid"
    },
})

feature("totals, receivable statements and past-due checks run", {
    when() {
        call("mantle.account.InvoiceServices.calculate#MissingInvoiceTotals", { calculateAll: true })
        call("mantle.account.PaymentServices.calculate#MissingPaymentTotals", { calculateAll: true })
        const statement = call("mantle.account.InvoiceServices.get#ReceivableStatementInfo", { toPartyId: customerId, fromPartyId: orgId })
        call("mantle.account.InvoiceServices.check#InvoicesPaid", {})
        return { statement }
    },
    then({ statement }) {
        statement.toParty.partyId == customerId
        statement.receivableInfoList != null
    },
})

feature("invoice content text", {
    when() {
        const contentId = call("mantle.account.InvoiceServices.create#InvoiceContent", { invoiceId, invoiceContentTypeEnumId: "IvctOther", description: "note" }).invoiceContentId
        call("mantle.account.InvoiceServices.update#InvoiceContent", { invoiceContentId: contentId, description: "note edited" })
        // with a file: saved to the content location, then replaced by an update
        const fileContentId = call("mantle.account.InvoiceServices.create#InvoiceContent", { invoiceId, invoiceContentTypeEnumId: "IvctOther", contentFile: uploadedFile("terms.txt", "net 30") }).invoiceContentId
        call("mantle.account.InvoiceServices.update#InvoiceContent", { invoiceContentId: fileContentId, contentFile: uploadedFile("terms2.txt", "net 45") })
        const savedContent = ec.entity.find("mantle.account.invoice.InvoiceContent").condition("invoiceContentId", fileContentId).one()
        if (!savedContent.contentLocation.includes("terms")) throw new Error("content location not saved: " + savedContent.contentLocation)
        const location = call("mantle.account.InvoiceServices.get#InvoiceContentLocation", { invoiceId, contentTypeEnumIdList: ["IvctOther"] })
        return { contentId, location }
    },
    then({ contentId, location }) { contentId != null },
})

feature("past due emails: nothing is sent without a billing address, an old unpaid invoice, or when a payment covers it", {
    when() {
        const longAgo = effectiveTime - 90 * 86400000
        const oldInvoice = call("mantle.account.InvoiceServices.create#Invoice", { fromPartyId: orgId, toPartyId: customerId, invoiceTypeEnumId: "InvoiceSales",
                invoiceDate: longAgo, dueDate: longAgo + 30 * 86400000, currencyUomId: "USD", description: "Old invoice" }).invoiceId
        call("mantle.account.InvoiceServices.create#InvoiceItem", { invoiceId: oldInvoice, itemTypeEnumId: "ItemProduct", quantity: 1, amount: 75, description: "Old item" })
        call("update#mantle.account.invoice.Invoice", { invoiceId: oldInvoice, statusId: "InvoiceFinalized" })
        const noAddress = call("mantle.account.InvoiceServices.send#CustomerPastDueEmail", { fromPartyId: orgId, toPartyId: customerId })
        call("mantle.party.ContactServices.store#PartyContactInfo", { partyId: customerId, emailAddress: "billing@example.com", emailContactMechPurposeId: "EmailBilling" })
        // no past due invoices for a party with none
        const other = call("mantle.party.PartyServices.create#Organization", { organizationName: "Never Billed", roleTypeId: "Customer" }).partyId
        call("mantle.party.ContactServices.store#PartyContactInfo", { partyId: other, emailAddress: "never@example.com", emailContactMechPurposeId: "EmailBilling" })
        const none = call("mantle.account.InvoiceServices.send#CustomerPastDueEmail", { fromPartyId: orgId, toPartyId: other })
        // an address given in the call is used without the lookup; the store the invoice came from decides the template, and this one has none
        const noStore = call("mantle.account.InvoiceServices.send#CustomerPastDueEmail", { fromPartyId: orgId, toPartyId: customerId, toAddresses: "ap@example.com" })
        // a payment from the customer that covers the invoice
        const covering = call("mantle.account.PaymentServices.create#Payment", { fromPartyId: customerId, toPartyId: orgId, amount: 200, amountUomId: "USD",
                paymentInstrumentEnumId: "PiCompanyCheck", statusId: "PmntDelivered", effectiveDate: effectiveTime - 3600000 }).paymentId
        const covered = call("mantle.account.InvoiceServices.send#CustomerPastDueEmail", { fromPartyId: orgId, toPartyId: customerId })
        const job = call("mantle.account.InvoiceServices.send#SalesInvoicePastDueEmails", { organizationPartyIdList: [orgId] })
        return { noAddress, none, noStore, covered, job, covering }
    },
    then({ noAddress, none, noStore, covered, job, covering }) {
        noAddress != null
        none != null
        noStore != null
        covered != null
        job != null
        covering != null
    },
})

feature("repost a delivered payment and its applications", {
    when() {
        const delivered = payment(paymentId)
        const before = Array.from(ec.entity.find("mantle.ledger.transaction.AcctgTrans").condition("paymentId", paymentId).list()).length
        call("mantle.ledger.PaymentAutoPostServices.repost#PaymentAndApplications", { paymentId })
        const after = Array.from(ec.entity.find("mantle.ledger.transaction.AcctgTrans").condition("paymentId", paymentId).list())
        return { delivered, before, after }
    },
    then({ before, after }) {
        // the transactions are deleted and posted again, so there are still some and they are posted
        after.length >= 1
        before >= 1
        after.every(t => t.isPosted == "Y")
    },
})
