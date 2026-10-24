// Port of AccountingActivities.groovy: ledger postings, un/re-post summaries, period closing, dividends and an expense invoice.
const organizationPartyId = "ORG_ZIZI_RETAIL", currencyUomId = "USD"
const organizationPartyId2 = "ORG_ZIZI_CORP"
const effectiveTime = Date.now()
let timePeriodId, timePeriodId2
// checkData returns only the error messages, not a count of fields checked, so there is no totalFieldsChecked total

spec({
    tempSequences: { start: 55100, banks: {
        "mantle.party.time.TimePeriod": 10, "mantle.account.invoice.Invoice": 10, "mantle.ledger.transaction.AcctgTrans": 10 } },
    setupSpec() {
        login("john.doe")
        // set an effective date so data check works, etc
        ec.user.setEffectiveTime(effectiveTime)
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

function entry(acctgTransId, glAccountId, debitCreditFlag, amount) {
    call("mantle.ledger.LedgerServices.create#AcctgTransEntry", { acctgTransId, glAccountId, debitCreditFlag, amount })
}
function newTrans(acctgTransTypeEnumId, orgId) {
    return call("mantle.ledger.LedgerServices.create#AcctgTrans", { acctgTransTypeEnumId, organizationPartyId: orgId, amountUomId: currencyUomId }).acctgTransId
}
function post(acctgTransId) { call("mantle.ledger.LedgerServices.post#AcctgTrans", { acctgTransId }) }

feature("initial Investment AcctgTrans", {
    when() {
        // find the current Fiscal Months
        let fiscalMonthOut = call("mantle.ledger.LedgerServices.get#OrganizationFiscalTimePeriods",
                { organizationPartyId, filterDate: ec.user.nowTimestamp, timePeriodTypeId: "FiscalMonth" })
        timePeriodId = fiscalMonthOut.timePeriodList[0].timePeriodId
        fiscalMonthOut = call("mantle.ledger.LedgerServices.get#OrganizationFiscalTimePeriods",
                { organizationPartyId: organizationPartyId2, filterDate: ec.user.nowTimestamp, timePeriodTypeId: "FiscalMonth" })
        timePeriodId2 = fiscalMonthOut.timePeriodList[0].timePeriodId

        // create investment postings
        let acctgTransId = newTrans("AttCapitalization", organizationPartyId)
        const firstAcctgTransId = acctgTransId
        entry(acctgTransId, "111100000", "D", 100000)
        entry(acctgTransId, "331100000", "C", 100000)
        post(acctgTransId)

        acctgTransId = newTrans("AttCapitalization", organizationPartyId)
        entry(acctgTransId, "111100000", "D", 125000)
        entry(acctgTransId, "331100000", "C", 100000)
        entry(acctgTransId, "332100000", "C", 25000)
        post(acctgTransId)

        acctgTransId = newTrans("AttCapitalization", organizationPartyId2)
        entry(acctgTransId, "111100000", "D", 150000)
        entry(acctgTransId, "331100000", "C", 150000)
        post(acctgTransId)

        // commented to test real time summary updates: recalculate summaries, create GlAccountOrgTimePeriod records
        // call("mantle.ledger.LedgerServices.recalculate#GlAccountOrgSummaries", {})

        const dataCheckErrors = checkData(`<entity-facade-xml>
            <acctgTrans acctgTransId="55100" organizationPartyId="${organizationPartyId}" amountUomId="USD" isPosted="Y" 
                    acctgTransTypeEnumId="AttCapitalization" glFiscalTypeEnumId="GLFT_ACTUAL" postedDate="${effectiveTime}" transactionDate="${effectiveTime}">
                <entries acctgTransEntrySeqId="01" amount="100000" glAccountId="111100000" reconcileStatusId="AterNot" isSummary="N" debitCreditFlag="D"/>
                <entries acctgTransEntrySeqId="02" amount="100000" glAccountId="331100000" reconcileStatusId="AterNot" isSummary="N" debitCreditFlag="C"/>
            </acctgTrans>
            <acctgTrans acctgTransId="55101" organizationPartyId="${organizationPartyId}" amountUomId="USD" isPosted="Y" 
                    acctgTransTypeEnumId="AttCapitalization" glFiscalTypeEnumId="GLFT_ACTUAL" postedDate="${effectiveTime}" transactionDate="${effectiveTime}">
                <entries acctgTransEntrySeqId="01" amount="125000" glAccountId="111100000" reconcileStatusId="AterNot" isSummary="N" debitCreditFlag="D"/>
                <entries acctgTransEntrySeqId="02" amount="100000" glAccountId="331100000" reconcileStatusId="AterNot" isSummary="N" debitCreditFlag="C"/>
                <entries acctgTransEntrySeqId="03" amount="25000" glAccountId="332100000" reconcileStatusId="AterNot" isSummary="N" debitCreditFlag="C"/>
            </acctgTrans>
            <acctgTrans acctgTransId="55102" organizationPartyId="ORG_ZIZI_CORP" amountUomId="USD" isPosted="Y" 
                    acctgTransTypeEnumId="AttCapitalization" glFiscalTypeEnumId="GLFT_ACTUAL" postedDate="${effectiveTime}" transactionDate="${effectiveTime}">
                <entries acctgTransEntrySeqId="01" amount="150000" glAccountId="111100000" reconcileStatusId="AterNot" isSummary="N" debitCreditFlag="D"/>
                <entries acctgTransEntrySeqId="02" amount="150000" glAccountId="331100000" reconcileStatusId="AterNot" isSummary="N" debitCreditFlag="C"/>
            </acctgTrans>
            
            <mantle.ledger.account.GlAccountOrgTimePeriod glAccountId="111100000" timePeriodId="${timePeriodId}"
                    postedCredits="0" postedDebits="225000" endingBalance="225000" organizationPartyId="${organizationPartyId}"/>
            <mantle.ledger.account.GlAccountOrgTimePeriod glAccountId="331100000" timePeriodId="${timePeriodId}"
                    postedCredits="200000" postedDebits="0" endingBalance="200000" organizationPartyId="${organizationPartyId}"/>
            <mantle.ledger.account.GlAccountOrgTimePeriod glAccountId="332100000" timePeriodId="${timePeriodId}"
                    postedCredits="25000" postedDebits="0" endingBalance="25000" organizationPartyId="${organizationPartyId}"/>

            <mantle.ledger.account.GlAccountOrgTimePeriod glAccountId="111100000" timePeriodId="${timePeriodId2}"
                    postedCredits="0" postedDebits="150000" endingBalance="150000" organizationPartyId="${organizationPartyId2}"/>
            <mantle.ledger.account.GlAccountOrgTimePeriod glAccountId="331100000" timePeriodId="${timePeriodId2}"
                    postedCredits="150000" postedDebits="0" endingBalance="150000" organizationPartyId="${organizationPartyId2}"/>
        </entity-facade-xml>`)
        if (ec.message.hasError()) log.warn(ec.message.getErrorsString())
        return { dataCheckErrors, firstAcctgTransId }
    },
    then({ dataCheckErrors, firstAcctgTransId }) {
        dataCheckErrors.length == 0
        firstAcctgTransId == "55100"
    },
})

feature("unpost and Check GlAccountOrgTimePeriod", {
    when() {
        call("mantle.ledger.LedgerServices.unpost#AcctgTrans", { acctgTransId: "55100" })

        const dataCheckErrors = checkData(`<entity-facade-xml>
            <acctgTrans acctgTransId="55100" organizationPartyId="${organizationPartyId}" amountUomId="USD" isPosted="N"/> 
            
            <mantle.ledger.account.GlAccountOrgTimePeriod glAccountId="111100000" timePeriodId="${timePeriodId}"
                    postedCredits="0" postedDebits="125000" endingBalance="125000" organizationPartyId="${organizationPartyId}"/>
            <mantle.ledger.account.GlAccountOrgTimePeriod glAccountId="331100000" timePeriodId="${timePeriodId}"
                    postedCredits="100000" postedDebits="0" endingBalance="100000" organizationPartyId="${organizationPartyId}"/>
        </entity-facade-xml>`)
        if (ec.message.hasError()) log.warn(ec.message.getErrorsString())
        return { dataCheckErrors }
    },
    then({ dataCheckErrors }) {
        dataCheckErrors.length == 0
    },
})

feature("repost and Check GlAccountOrgTimePeriod", {
    when() {
        post("55100")

        const dataCheckErrors = checkData(`<entity-facade-xml>
            <acctgTrans acctgTransId="55100" organizationPartyId="${organizationPartyId}" amountUomId="USD" isPosted="Y"/> 
            
            <mantle.ledger.account.GlAccountOrgTimePeriod glAccountId="111100000" timePeriodId="${timePeriodId}"
                    postedCredits="0" postedDebits="225000" endingBalance="225000" organizationPartyId="${organizationPartyId}"/>
            <mantle.ledger.account.GlAccountOrgTimePeriod glAccountId="331100000" timePeriodId="${timePeriodId}"
                    postedCredits="200000" postedDebits="0" endingBalance="200000" organizationPartyId="${organizationPartyId}"/>
        </entity-facade-xml>`)
        if (ec.message.hasError()) log.warn(ec.message.getErrorsString())
        return { dataCheckErrors }
    },
    then({ dataCheckErrors }) {
        dataCheckErrors.length == 0
    },
})

feature("record Retained Earnings and Dividends Distributable AcctgTrans", {
    when() {
        // Net Income to Retained Earnings
        let acctgTransId = newTrans("AttPeriodClosing", organizationPartyId)
        entry(acctgTransId, "850000000", "D", 1000)
        entry(acctgTransId, "335000000", "C", 1000)
        post(acctgTransId)

        // Retained Earnings to Dividends - Common Stock
        acctgTransId = newTrans("AttPeriodClosing", organizationPartyId)
        entry(acctgTransId, "335000000", "D", 600)
        entry(acctgTransId, "333100000", "C", 600)
        post(acctgTransId)

        const dataCheckErrors = checkData(`<entity-facade-xml>
            <acctgTrans acctgTransId="55103" organizationPartyId="ORG_ZIZI_RETAIL" amountUomId="USD" isPosted="Y" 
                    acctgTransTypeEnumId="AttPeriodClosing" glFiscalTypeEnumId="GLFT_ACTUAL" postedDate="${effectiveTime}" transactionDate="${effectiveTime}">
                <entries acctgTransEntrySeqId="01" amount="1000" glAccountId="850000000" reconcileStatusId="AterNot" isSummary="N" debitCreditFlag="D"/>
                <entries acctgTransEntrySeqId="02" amount="1000" glAccountId="335000000" reconcileStatusId="AterNot" isSummary="N" debitCreditFlag="C"/>
            </acctgTrans>
            <acctgTrans acctgTransId="55104" organizationPartyId="ORG_ZIZI_RETAIL" amountUomId="USD" isPosted="Y" 
                    acctgTransTypeEnumId="AttPeriodClosing" glFiscalTypeEnumId="GLFT_ACTUAL" postedDate="${effectiveTime}" transactionDate="${effectiveTime}">
                <entries acctgTransEntrySeqId="01" amount="600" glAccountId="335000000" reconcileStatusId="AterNot" isSummary="N" debitCreditFlag="D"/>
                <entries acctgTransEntrySeqId="02" amount="600" glAccountId="333100000" reconcileStatusId="AterNot" isSummary="N" debitCreditFlag="C"/>
            </acctgTrans>            
        </entity-facade-xml>`)
        if (ec.message.hasError()) log.warn(ec.message.getErrorsString())
        return { dataCheckErrors }
    },
    then({ dataCheckErrors }) {
        dataCheckErrors.length == 0
    },
})

feature("pay Dividends AcctgTrans", {
    when() {
        const acctgTransId = newTrans("AttDisbursement", organizationPartyId)
        entry(acctgTransId, "333100000", "D", 300)
        entry(acctgTransId, "111100000", "C", 300)
        post(acctgTransId)

        // (the Groovy had a second, commented out, disbursement of 50000 from 335000000 to show both dividends in different states)

        const dataCheckErrors = checkData(`<entity-facade-xml>
        <acctgTrans acctgTransId="55105" organizationPartyId="ORG_ZIZI_RETAIL" amountUomId="USD" isPosted="Y" 
                acctgTransTypeEnumId="AttDisbursement" glFiscalTypeEnumId="GLFT_ACTUAL" postedDate="${effectiveTime}" transactionDate="${effectiveTime}">
            <entries acctgTransEntrySeqId="01" amount="300" glAccountId="333100000" reconcileStatusId="AterNot" isSummary="N" debitCreditFlag="D"/>
            <entries acctgTransEntrySeqId="02" amount="300" glAccountId="111100000" reconcileStatusId="AterNot" isSummary="N" debitCreditFlag="C"/>
        </acctgTrans>
        </entity-facade-xml>`)
        if (ec.message.hasError()) log.warn(ec.message.getErrorsString())
        return { dataCheckErrors }
    },
    then({ dataCheckErrors }) {
        dataCheckErrors.length == 0
    },
})

feature("expense Invoice", {
    when() {
        const invoiceId = call("mantle.account.InvoiceServices.create#Invoice",
                { fromPartyId: "ZiddlemanInc", toPartyId: organizationPartyId, currencyUomId }).invoiceId

        for (const [itemTypeEnumId, description, amount] of [
            ["ItemExpCommTelephone", "Land Line Service", 123.45],
            ["ItemExpCommCellular", "Cell Service", 234.56],
            ["ItemExpCommNetwork", "Internet Service", 345.67],
            ["ItemExpHosting", "Site Hosting", 45.45],
            ["ItemExpOfficeSup", "Office Supplies", 101.01],
            ["ItemExpUtilHeating", "Heating", 33.33],
            ["ItemExpUtilElec", "Electricity", 111.11],
            ["ItemExpUtilWater", "Water", 30],
            ["ItemExpUtilTrash", "Trash Disposal", 34],
            ["ItemExpInterestEquip", "Equipment Interest", 321.12],
            ["ItemExpInterestReal", "Real Estate Interest", 444.55],
        ]) {
            call("mantle.account.InvoiceServices.create#InvoiceItem", { invoiceId, itemTypeEnumId, description, quantity: 1, amount })
        }

        call("update#mantle.account.invoice.Invoice", { invoiceId, statusId: "InvoiceReceived" })
        call("update#mantle.account.invoice.Invoice", { invoiceId, statusId: "InvoiceApproved" })

        const dataCheckErrors = checkData(`<entity-facade-xml>
            <mantle.account.invoice.Invoice invoiceId="${invoiceId}" invoiceTypeEnumId="InvoiceSales" toPartyId="ORG_ZIZI_RETAIL"
                    fromPartyId="ZiddlemanInc" acctgTransResultEnumId="AtrSuccess" invoiceDate="${effectiveTime}"
                    currencyUomId="USD" statusId="InvoiceApproved">
                <mantle.account.invoice.InvoiceItem amount="123.45" quantity="1" description="Land Line Service"
                        invoiceItemSeqId="01" itemTypeEnumId="ItemExpCommTelephone"/>
                <mantle.account.invoice.InvoiceItem amount="234.56" quantity="1" description="Cell Service"
                        invoiceItemSeqId="02" itemTypeEnumId="ItemExpCommCellular"/>
                <mantle.account.invoice.InvoiceItem amount="345.67" quantity="1" description="Internet Service"
                        invoiceItemSeqId="03" itemTypeEnumId="ItemExpCommNetwork"/>
                <mantle.account.invoice.InvoiceItem amount="45.45" quantity="1" description="Site Hosting"
                        invoiceItemSeqId="04" itemTypeEnumId="ItemExpHosting"/>
                <mantle.account.invoice.InvoiceItem amount="101.01" quantity="1" description="Office Supplies"
                        invoiceItemSeqId="05" itemTypeEnumId="ItemExpOfficeSup"/>
                <mantle.account.invoice.InvoiceItem amount="33.33" quantity="1" description="Heating"
                        invoiceItemSeqId="06" itemTypeEnumId="ItemExpUtilHeating"/>
                <mantle.account.invoice.InvoiceItem amount="111.11" quantity="1" description="Electricity"
                        invoiceItemSeqId="07" itemTypeEnumId="ItemExpUtilElec"/>
                <mantle.account.invoice.InvoiceItem amount="30" quantity="1" description="Water"
                        invoiceItemSeqId="08" itemTypeEnumId="ItemExpUtilWater"/>
                <mantle.account.invoice.InvoiceItem amount="34" quantity="1" description="Trash Disposal"
                        invoiceItemSeqId="09" itemTypeEnumId="ItemExpUtilTrash"/>
                <mantle.account.invoice.InvoiceItem amount="321.12" quantity="1" description="Equipment Interest"
                        invoiceItemSeqId="10" itemTypeEnumId="ItemExpInterestEquip"/>
                <mantle.account.invoice.InvoiceItem amount="444.55" quantity="1" description="Real Estate Interest"
                        invoiceItemSeqId="11" itemTypeEnumId="ItemExpInterestReal"/>
            </mantle.account.invoice.Invoice>
            <mantle.ledger.transaction.AcctgTrans acctgTransId="55106" invoiceId="${invoiceId}" otherPartyId="ZiddlemanInc"
                    postedDate="${effectiveTime}" amountUomId="USD" isPosted="Y" acctgTransTypeEnumId="AttPurchaseInvoice"
                    glFiscalTypeEnumId="GLFT_ACTUAL" transactionDate="${effectiveTime}" organizationPartyId="ORG_ZIZI_RETAIL">
                <mantle.ledger.transaction.AcctgTransEntry amount="123.45" glAccountId="614110000" reconcileStatusId="AterNot"
                        invoiceItemSeqId="01" debitCreditFlag="D" acctgTransEntrySeqId="01"/>
                <mantle.ledger.transaction.AcctgTransEntry amount="234.56" glAccountId="614140000" reconcileStatusId="AterNot"
                        invoiceItemSeqId="02" debitCreditFlag="D" acctgTransEntrySeqId="02"/>
                <mantle.ledger.transaction.AcctgTransEntry amount="345.67" glAccountId="614200000" reconcileStatusId="AterNot"
                        invoiceItemSeqId="03" debitCreditFlag="D" acctgTransEntrySeqId="03"/>
                <mantle.ledger.transaction.AcctgTransEntry amount="45.45" glAccountId="616300000" reconcileStatusId="AterNot"
                        invoiceItemSeqId="04" debitCreditFlag="D" acctgTransEntrySeqId="04"/>
                <mantle.ledger.transaction.AcctgTransEntry amount="101.01" glAccountId="652100000" reconcileStatusId="AterNot"
                        invoiceItemSeqId="05" debitCreditFlag="D" acctgTransEntrySeqId="05"/>
                <mantle.ledger.transaction.AcctgTransEntry amount="33.33" glAccountId="611210000" reconcileStatusId="AterNot"
                        invoiceItemSeqId="06" debitCreditFlag="D" acctgTransEntrySeqId="06"/>
                <mantle.ledger.transaction.AcctgTransEntry amount="111.11" glAccountId="611220000" reconcileStatusId="AterNot"
                        invoiceItemSeqId="07" debitCreditFlag="D" acctgTransEntrySeqId="07"/>
                <mantle.ledger.transaction.AcctgTransEntry amount="30" glAccountId="611230000" reconcileStatusId="AterNot"
                        invoiceItemSeqId="08" debitCreditFlag="D" acctgTransEntrySeqId="08"/>
                <mantle.ledger.transaction.AcctgTransEntry amount="34" glAccountId="611240000" reconcileStatusId="AterNot"
                        invoiceItemSeqId="09" debitCreditFlag="D" acctgTransEntrySeqId="09"/>
                <mantle.ledger.transaction.AcctgTransEntry amount="321.12" glAccountId="791100000" reconcileStatusId="AterNot"
                        invoiceItemSeqId="10" debitCreditFlag="D" acctgTransEntrySeqId="10"/>
                <mantle.ledger.transaction.AcctgTransEntry amount="444.55" glAccountId="791300000" reconcileStatusId="AterNot"
                        invoiceItemSeqId="11" debitCreditFlag="D" acctgTransEntrySeqId="11"/>
                <mantle.ledger.transaction.AcctgTransEntry amount="1824.25" glAccountId="212000000" reconcileStatusId="AterNot"
                        glAccountTypeEnumId="GatAccountsPayable" debitCreditFlag="C" acctgTransEntrySeqId="12"/>
            </mantle.ledger.transaction.AcctgTrans>
        </entity-facade-xml>`)
        if (ec.message.hasError()) log.warn(ec.message.getErrorsString())
        return { dataCheckErrors }
    },
    then({ dataCheckErrors }) {
        dataCheckErrors.length == 0
    },
})
