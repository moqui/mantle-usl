// Financial accounts (mantle.account.FinancialAccountServices): deposits, withdrawals, transfers, authorizations,
// disbursement and replenishment through payments, statements. New spec, no Groovy original.
const effectiveTime = Date.now()
let orgId, ownerId, finAccountId, otherAccountId, authId

spec({
    stepwise: true,
    tempSequences: { start: 57300, banks: { "mantle.party.Party": 10, "mantle.account.payment.Payment": 20,
        "mantle.account.financial.FinancialAccount": 10, "mantle.account.financial.FinancialAccountTrans": 30,
        "mantle.party.time.TimePeriod": 30, "mantle.ledger.transaction.AcctgTrans": 40 } },
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
const account = (id) => ec.entity.find("mantle.account.financial.FinancialAccount").condition("finAccountId", id).one()
const transList = (id) => Array.from(ec.entity.find("mantle.account.financial.FinancialAccountTrans").condition("finAccountId", id).orderBy("finAccountTransId").list())

feature("create financial accounts, and get or create finds the same one", {
    when() {
        orgId = call("mantle.party.PartyServices.create#Organization", { organizationName: "FinAcct Org", roleTypeId: "Supplier" }).partyId
        call("create#mantle.party.PartyRole", { partyId: orgId, roleTypeId: "OrgInternal" })
        call("mantle.ledger.LedgerServices.init#PartyAccountingConfiguration", { sourcePartyId: "DefaultSettings", organizationPartyId: orgId, startYear: String(new Date(effectiveTime).getUTCFullYear()) })
        ownerId = call("mantle.party.PartyServices.create#Person", { firstName: "Fin", lastName: "Owner" }).partyId
        finAccountId = call("mantle.account.FinancialAccountServices.create#FinancialAccount", { finAccountTypeId: "CustomerCredit", finAccountName: "Credit A",
                organizationPartyId: orgId, ownerPartyId: ownerId, currencyUomId: "USD" }).finAccountId
        otherAccountId = call("mantle.account.FinancialAccountServices.create#FinancialAccount", { finAccountTypeId: "DepositAccount", finAccountName: "Deposit B",
                organizationPartyId: orgId, ownerPartyId: ownerId, currencyUomId: "USD" }).finAccountId
        call("mantle.account.FinancialAccountServices.update#FinancialAccount", { finAccountId, finAccountName: "Credit A renamed" })
        const same = call("mantle.account.FinancialAccountServices.getOrCreate#FinancialAccount", { finAccountTypeId: "CustomerCredit", organizationPartyId: orgId, ownerPartyId: ownerId })
        return { same, a: account(finAccountId) }
    },
    then({ same, a }) {
        a.finAccountName == "Credit A renamed"
        a.statusId == "FaActive"
        same.finAccountId == finAccountId
    },
})

feature("deposit, withdraw and adjust move the balance", {
    when() {
        const dep = call("mantle.account.FinancialAccountServices.deposit#FinancialAccount", { finAccountId, amount: 200, comments: "first deposit" })
        const wd = call("mantle.account.FinancialAccountServices.withdraw#FinancialAccount", { finAccountId, amount: 50 })
        const adj = call("mantle.account.FinancialAccountServices.adjust#FinancialAccount", { finAccountId, amount: -10 })
        const over = call("mantle.account.FinancialAccountServices.withdraw#FinancialAccount", { finAccountId, amount: 1000 })
        const totals = call("mantle.account.FinancialAccountServices.calculate#FinancialAccountTotals", { finAccountId })
        return { dep, wd, adj, over, totals, trans: transList(finAccountId) }
    },
    then({ dep, wd, adj, over, totals, trans }) {
        n(dep.postBalance) == 200
        n(wd.postBalance) == 150
        n(adj.postBalance) == 140
        over.responseCode != "success"
        n(totals.actualBalance) == 140
        trans.length == 3
    },
})

feature("transfer between accounts and reverse a transaction", {
    when() {
        const out = call("mantle.account.FinancialAccountServices.transfer#FinancialAccount", { fromFinAccountId: finAccountId, toFinAccountId: otherAccountId, amount: 40, comments: "move" })
        const from = call("mantle.account.FinancialAccountServices.calculate#FinancialAccountTotals", { finAccountId })
        const to = call("mantle.account.FinancialAccountServices.calculate#FinancialAccountTotals", { finAccountId: otherAccountId })
        call("mantle.account.FinancialAccountServices.reverse#FinancialAccountTrans", { finAccountTransId: out.depositFinAccountTransId })
        const toAfter = call("mantle.account.FinancialAccountServices.calculate#FinancialAccountTotals", { finAccountId: otherAccountId })
        return { out, from, to, toAfter }
    },
    then({ out, from, to, toAfter }) {
        out.withdrawFinAccountTransId != null
        n(from.actualBalance) == 100
        n(to.actualBalance) == 40
        n(toAfter.actualBalance) == 0
    },
})

feature("authorize an amount, which lowers the available balance, then expire the authorization", {
    when() {
        const auth = call("mantle.account.FinancialAccountServices.authorize#FinancialAccount", { finAccountId, amount: 30 })
        authId = auth.finAccountAuthId
        const during = call("mantle.account.FinancialAccountServices.calculate#FinancialAccountTotals", { finAccountId })
        call("mantle.account.FinancialAccountServices.expire#FinancialAccountAuth", { finAccountAuthId: authId })
        const after = call("mantle.account.FinancialAccountServices.calculate#FinancialAccountTotals", { finAccountId })
        const tooMuch = call("mantle.account.FinancialAccountServices.authorize#FinancialAccount", { finAccountId, amount: 100000 })
        return { auth, during, after, tooMuch }
    },
    then({ auth, during, after, tooMuch }) {
        auth.finAccountAuthId != null
        n(during.availableBalance) == 70
        n(after.availableBalance) == 100
        tooMuch.responseCode != "success"
    },
})

feature("disburse and replenish through payments", {
    when() {
        const disb = call("mantle.account.FinancialAccountServices.disburse#FinancialAccount", { finAccountId, amount: 25 })
        const disbPayment = ec.entity.find("mantle.account.payment.Payment").condition("paymentId", disb.paymentId).one()
        const repl = call("mantle.account.FinancialAccountServices.replenish#FinancialAccount", { finAccountId, amount: 60, paymentInstrumentEnumId: "PiCompanyCheck" })
        const replPayment = ec.entity.find("mantle.account.payment.Payment").condition("paymentId", repl.paymentId).one()
        const totals = call("mantle.account.FinancialAccountServices.calculate#FinancialAccountTotals", { finAccountId })
        return { disb, disbPayment, repl, replPayment, totals }
    },
    then({ disb, disbPayment, repl, replPayment, totals }) {
        disb.finAccountTransId != null
        disbPayment.paymentTypeEnumId == "PtFinancialAccount"
        disbPayment.fromPartyId == orgId
        disbPayment.toPartyId == ownerId
        repl.paymentId != null
        replPayment.fromPartyId == ownerId
        n(totals.actualBalance) == 135
    },
})

feature("statement print info", {
    when() {
        const year = String(new Date(effectiveTime).getUTCFullYear()), month = String(new Date(effectiveTime).getUTCMonth() + 1)
        return { info: call("mantle.account.FinancialAccountServices.get#StatementPrintInfo", { finAccountId, year, month }) }
    },
    then({ info }) {
        info.financialAccount.finAccountId == finAccountId
        info.financialAccountTransList.length >= 1
    },
})

feature("pay from a financial account through the local gateway: authorize, release, authorize again, capture and refund", {
    when() {
        call("mantle.account.FinancialAccountServices.deposit#FinancialAccount", { finAccountId, amount: 500 })
        const before = account(finAccountId)
        const newPayment = (amount) => call("mantle.account.PaymentServices.create#Payment", { fromPartyId: ownerId, toPartyId: orgId, amount, amountUomId: "USD",
                paymentInstrumentEnumId: "PiFinancialAccount", finAccountId, statusId: "PmntPromised", effectiveDate: effectiveTime - 3600000 }).paymentId
        const paymentId = newPayment(40)
        const authorized = call("mantle.account.PaymentServices.authorize#SinglePayment", { paymentId })
        const afterAuth = ec.entity.find("mantle.account.payment.Payment").condition("paymentId", paymentId).one()
        const released = call("mantle.account.PaymentServices.release#SinglePayment", { paymentId })
        const afterRelease = ec.entity.find("mantle.account.payment.Payment").condition("paymentId", paymentId).one()
        call("mantle.account.PaymentServices.authorize#SinglePayment", { paymentId })
        const captured = call("mantle.account.PaymentServices.capture#SinglePayment", { paymentId })
        const afterCapture = ec.entity.find("mantle.account.payment.Payment").condition("paymentId", paymentId).one()
        const balanceAfterCapture = call("mantle.account.FinancialAccountServices.calculate#FinancialAccountTotals", { finAccountId })
        const refund = call("mantle.account.PaymentServices.refund#SinglePayment", { paymentId, amount: 15 })
        const noAccount = (() => {
            const loose = call("mantle.account.PaymentServices.create#Payment", { fromPartyId: ownerId, toPartyId: orgId, amount: 5, amountUomId: "USD",
                    paymentInstrumentEnumId: "PiFinancialAccount", statusId: "PmntPromised", effectiveDate: effectiveTime - 3600000 }).paymentId
            return errorOf("mantle.account.FinancialAccountServices.authorize#FinancialAccountPayment", { paymentId: loose, paymentGatewayConfigId: "FinancialAccountLocal" })
        })()
        const notAuthorized = errorOf("mantle.account.FinancialAccountServices.release#FinancialAccountPayment", { paymentId: newPayment(3), paymentGatewayConfigId: "FinancialAccountLocal" })
        return { before, authorized, afterAuth, released, afterRelease, captured, afterCapture, balanceAfterCapture, refund, noAccount, notAuthorized }
    },
    then({ before, authorized, afterAuth, released, afterRelease, captured, afterCapture, refund, noAccount, notAuthorized }) {
        authorized.paymentGatewayResponse.resultSuccess == "Y"
        afterAuth.statusId == "PmntAuthorized"
        afterAuth.finAccountAuthId != null
        released.paymentGatewayResponse == null || released.paymentGatewayResponseId != null
        afterRelease.statusId == "PmntPromised"
        afterRelease.finAccountAuthId == null
        captured.paymentGatewayResponse.resultSuccess == "Y"
        afterCapture.statusId == "PmntDelivered"
        afterCapture.finAccountTransId != null
        refund.refundPaymentId != null
        noAccount.includes("No Financial Account associated")
        notAuthorized.includes("No authorization associated")
    },
})

feature("an invoice item for a financial account makes its deposit or withdrawal once", {
    when() {
        const invoiceId = call("mantle.account.InvoiceServices.create#Invoice", { fromPartyId: orgId, toPartyId: ownerId, invoiceTypeEnumId: "InvoiceSales",
                invoiceDate: effectiveTime - 3600000, currencyUomId: "USD" }).invoiceId
        const itemSeqId = call("mantle.account.InvoiceServices.create#InvoiceItem", { invoiceId, itemTypeEnumId: "ItemProduct", finAccountId, quantity: 1, amount: 30,
                description: "credit purchase" }).invoiceItemSeqId
        const before = account(finAccountId)
        const first = call("mantle.account.FinancialAccountServices.checkCreate#InvoiceItemTrans", { invoiceId, invoiceItemSeqId: itemSeqId })
        const item = ec.entity.find("mantle.account.invoice.InvoiceItem").condition("invoiceId", invoiceId).condition("invoiceItemSeqId", itemSeqId).one()
        const second = call("mantle.account.FinancialAccountServices.checkCreate#InvoiceItemTrans", { invoiceId, invoiceItemSeqId: itemSeqId })
        const wrongParty = call("mantle.account.InvoiceServices.create#Invoice", { fromPartyId: "ORG_ZIZI_RETAIL", toPartyId: "JoeDist", invoiceTypeEnumId: "InvoiceSales", invoiceDate: effectiveTime - 3600000, currencyUomId: "USD" }).invoiceId
        const wrongSeq = call("mantle.account.InvoiceServices.create#InvoiceItem", { invoiceId: wrongParty, itemTypeEnumId: "ItemProduct", finAccountId, quantity: 1, amount: 5, description: "wrong" }).invoiceItemSeqId
        const refused = errorOf("mantle.account.FinancialAccountServices.checkCreate#InvoiceItemTrans", { invoiceId: wrongParty, invoiceItemSeqId: wrongSeq })
        return { before, first, item, second, refused }
    },
    then({ first, item, second, refused }) {
        first.finAccountTransId != null
        item.finAccountTransId == first.finAccountTransId
        second.finAccountTransId == first.finAccountTransId
        refused.includes("is not a party to invoice")
    },
})
