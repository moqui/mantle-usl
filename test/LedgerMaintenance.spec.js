// GL accounts, transactions, journals, period closing and reposting (mantle.ledger.LedgerServices and the auto post
// services) for a new organization. New spec, no Groovy original.
const effectiveTime = Date.now()
const year = String(new Date(effectiveTime).getUTCFullYear())
let orgId, cashAccountId, expenseAccountId, newAccountId, transId, entrySeqId, journalId, monthId, invoiceId

spec({
    stepwise: true,
    tempSequences: { start: 57100, banks: { "mantle.party.Party": 10, "mantle.account.invoice.Invoice": 10, "mantle.party.time.TimePeriod": 60,
        "mantle.ledger.transaction.AcctgTrans": 50, "mantle.ledger.transaction.GlJournal": 10 } },
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
const trans = (id) => ec.entity.find("mantle.ledger.transaction.AcctgTrans").condition("acctgTransId", id).one()
const entries = (id) => Array.from(ec.entity.find("mantle.ledger.transaction.AcctgTransEntry").condition("acctgTransId", id).orderBy("acctgTransEntrySeqId").list())

feature("set up an organization with accounting configuration", {
    when() {
        orgId = call("mantle.party.PartyServices.create#Organization", { organizationName: "Ledger Org", roleTypeId: "Supplier" }).partyId
        call("create#mantle.party.PartyRole", { partyId: orgId, roleTypeId: "OrgInternal" })
        call("mantle.ledger.LedgerServices.init#PartyAccountingConfiguration", { sourcePartyId: "DefaultSettings", organizationPartyId: orgId, startYear: year })
        const classes = call("org.moqui.impl.BasicServices.find#EnumerationByParent", { parentEnumId: "EXPENSE", includeNested: true })
        const accounts = Array.from(ec.entity.find("mantle.ledger.account.GlAccountAndOrganization").condition("organizationPartyId", orgId)
                .condition("glAccountClassEnumId", "in", Array.from(classes.enumIdSet)).orderBy("accountCode").list())
        // the first accounts are summary accounts that do not allow posting
        expenseAccountId = accounts.find(a => a.disallowPosting !== "Y").glAccountId
        cashAccountId = Array.from(ec.entity.find("mantle.ledger.account.GlAccountAndOrganization").condition("organizationPartyId", orgId)
                .condition("glAccountClassEnumId", "CASH_EQUIVALENT").orderBy("accountCode").list()).find(a => a.disallowPosting !== "Y").glAccountId
        return { accounts: accounts.length }
    },
    then({ accounts }) {
        accounts > 0
        expenseAccountId != null
        cashAccountId != null
    },
})

feature("create a GL account, set the flags and find a default account by type", {
    when() {
        newAccountId = call("mantle.ledger.LedgerServices.create#GlAccount", { accountCode: "799" + String(effectiveTime).slice(-6), accountName: "Test Expense",
                glAccountClassEnumId: "GEN_ADMIN_EXPENSE" }).glAccountId
        call("mantle.ledger.LedgerServices.set#MissingGlAccountFlags", {})
        const account = ec.entity.find("mantle.ledger.account.GlAccount").condition("glAccountId", newAccountId).one()
        const defaults = Array.from(ec.entity.find("mantle.ledger.config.GlAccountTypeDefault").condition("organizationPartyId", orgId).list())
        const typeId = defaults[0].glAccountTypeEnumId
        const found = call("mantle.ledger.LedgerServices.get#DefaultGlAccountByType", { glAccountTypeEnumId: typeId, organizationPartyId: orgId })
        return { account, found, expected: defaults[0].glAccountId }
    },
    then({ account, found, expected }) {
        account.accountName == "Test Expense"
        account.isDebit == "Y"
        found.glAccountId == expected
    },
})

feature("an unbalanced transaction goes to the error journal, a balanced one can be edited, posted, moved and unposted", {
    when() {
        const badId = call("mantle.ledger.LedgerServices.create#AcctgTrans", { acctgTransTypeEnumId: "AttCapitalization", organizationPartyId: orgId, amountUomId: "USD" }).acctgTransId
        call("mantle.ledger.LedgerServices.create#AcctgTransEntry", { acctgTransId: badId, glAccountId: cashAccountId, debitCreditFlag: "D", amount: 100 })
        call("mantle.ledger.LedgerServices.create#AcctgTransEntry", { acctgTransId: badId, glAccountId: expenseAccountId, debitCreditFlag: "C", amount: 90 })
        call("mantle.ledger.LedgerServices.post#AcctgTrans", { acctgTransId: badId })
        const bad = trans(badId)
        ec.message.clearErrors()

        transId = call("mantle.ledger.LedgerServices.create#AcctgTrans", { acctgTransTypeEnumId: "AttCapitalization", organizationPartyId: orgId, amountUomId: "USD" }).acctgTransId
        call("mantle.ledger.LedgerServices.create#AcctgTransEntry", { acctgTransId: transId, glAccountId: cashAccountId, debitCreditFlag: "D", amount: 100 })
        entrySeqId = call("mantle.ledger.LedgerServices.create#AcctgTransEntry", { acctgTransId: transId, glAccountId: expenseAccountId, debitCreditFlag: "C", amount: 90 }).acctgTransEntrySeqId
        call("mantle.ledger.LedgerServices.update#AcctgTransEntry", { acctgTransId: transId, acctgTransEntrySeqId: entrySeqId, amount: 100 })
        call("mantle.ledger.LedgerServices.update#AcctgTrans", { acctgTransId: transId, description: "Edited trans" })
        const notPosted = errorOf("mantle.ledger.LedgerServices.move#AcctgTransEntry", { acctgTransId: transId, acctgTransEntrySeqId: entrySeqId, glAccountId: newAccountId })
        const extra = call("mantle.ledger.LedgerServices.create#AcctgTransEntry", { acctgTransId: transId, glAccountId: expenseAccountId, debitCreditFlag: "C", amount: 1 }).acctgTransEntrySeqId
        call("mantle.ledger.LedgerServices.delete#AcctgTransEntry", { acctgTransId: transId, acctgTransEntrySeqId: extra })
        const count = entries(transId).length
        call("mantle.ledger.LedgerServices.post#AcctgTrans", { acctgTransId: transId })
        const posted = trans(transId)
        const moveOut = call("mantle.ledger.LedgerServices.move#AcctgTransEntry", { acctgTransId: transId, acctgTransEntrySeqId: entrySeqId, glAccountId: newAccountId })
        call("mantle.ledger.LedgerServices.update#AcctgTransPosted", { acctgTransId: transId, description: "Posted trans" })
        const described = trans(transId)
        call("mantle.ledger.LedgerServices.unpost#AcctgTrans", { acctgTransId: transId })
        const unposted = trans(transId)
        return { bad, notPosted, moveOut, count, posted, described, unposted }
    },
    then({ bad, notPosted, moveOut, count, posted, described, unposted }) {
        bad.isPosted != "Y"
        bad.glJournalId != null
        notPosted.includes("transaction is not posted")
        count == 2
        posted.isPosted == "Y"
        moveOut.acctgTransId != null
        entries(moveOut.acctgTransId).some(e => e.glAccountId == newAccountId)
        described.description == "Posted trans"
        unposted.isPosted == "N"
    },
})

feature("journals: create, update and post a journal of transactions", {
    when() {
        journalId = call("mantle.ledger.LedgerServices.create#GlJournal", { glJournalName: "Test Journal", organizationPartyId: orgId }).glJournalId
        call("mantle.ledger.LedgerServices.update#GlJournal", { glJournalId: journalId, glJournalName: "Test Journal 2" })
        const jTransId = call("mantle.ledger.LedgerServices.create#AcctgTrans", { acctgTransTypeEnumId: "AttCapitalization", organizationPartyId: orgId, amountUomId: "USD", glJournalId: journalId }).acctgTransId
        call("mantle.ledger.LedgerServices.create#AcctgTransEntry", { acctgTransId: jTransId, glAccountId: cashAccountId, debitCreditFlag: "D", amount: 50 })
        call("mantle.ledger.LedgerServices.create#AcctgTransEntry", { acctgTransId: jTransId, glAccountId: newAccountId, debitCreditFlag: "C", amount: 50 })
        call("mantle.ledger.LedgerServices.post#GlJournal", { glJournalId: journalId, closeJournal: true })
        const journal = ec.entity.find("mantle.ledger.transaction.GlJournal").condition("glJournalId", journalId).one()
        return { journal, jTrans: trans(jTransId) }
    },
    then({ journal, jTrans }) {
        journal.glJournalName == "Test Journal 2"
        journal.isPosted == "Y"
        jTrans.isPosted == "Y"
    },
})

feature("fiscal periods: check the next ones, close a past month, recalculate, create closing transactions and reopen", {
    when() {
        call("mantle.ledger.LedgerServices.check#NextFiscalTimePeriods", { organizationPartyId: orgId })
        const months = Array.from(ec.entity.find("mantle.party.time.TimePeriod").condition("partyId", orgId).condition("timePeriodTypeId", "FiscalMonth").orderBy("fromDate").list())
        monthId = months[0].timePeriodId
        call("mantle.ledger.LedgerServices.close#FinancialTimePeriod", { timePeriodId: monthId })
        const closed = ec.entity.find("mantle.party.time.TimePeriod").condition("timePeriodId", monthId).one().isClosed
        const again = errorOf("mantle.ledger.LedgerServices.close#FinancialTimePeriod", { timePeriodId: monthId })
        call("mantle.ledger.LedgerServices.recalculate#GlAccountOrgTimePeriodAmounts", { timePeriodId: monthId })
        const close = call("mantle.ledger.LedgerServices.create#PeriodCloseAcctgTrans", { timePeriodId: monthId })
        call("mantle.ledger.LedgerServices.reopen#FinancialTimePeriod", { timePeriodId: monthId })
        const reopened = ec.entity.find("mantle.party.time.TimePeriod").condition("timePeriodId", monthId).one().isClosed
        return { closed, again, close, reopened }
    },
    then({ closed, again, close, reopened }) {
        closed == "Y"
        again != null
        close.acctgTransIdByClassId != null
        reopened == "N"
    },
})

feature("repost an invoice and its transactions", {
    when() {
        const customer = call("mantle.party.PartyServices.create#Organization", { organizationName: "Ledger Customer", roleTypeId: "Customer" }).partyId
        invoiceId = call("mantle.account.InvoiceServices.create#Invoice", { fromPartyId: orgId, toPartyId: customer, invoiceTypeEnumId: "InvoiceSales", invoiceDate: effectiveTime - 3600000, currencyUomId: "USD" }).invoiceId
        call("mantle.account.InvoiceServices.create#InvoiceItem", { invoiceId, itemTypeEnumId: "ItemProduct", quantity: 1, amount: 75, description: "Thing" })
        call("update#mantle.account.invoice.Invoice", { invoiceId, statusId: "InvoiceFinalized" })
        const before = Array.from(ec.entity.find("mantle.ledger.transaction.AcctgTrans").condition("invoiceId", invoiceId).list()).length
        call("mantle.ledger.InvoiceAutoPostServices.repost#Invoice", { invoiceId })
        const after = Array.from(ec.entity.find("mantle.ledger.transaction.AcctgTrans").condition("invoiceId", invoiceId).condition("isPosted", "Y").list()).length
        call("mantle.ledger.InvoiceAutoPostServices.repost#AllInvoices", { fromDate: effectiveTime - 86400000 })
        return { before, after }
    },
    then({ before, after }) {
        before >= 1
        after >= 1
    },
})
