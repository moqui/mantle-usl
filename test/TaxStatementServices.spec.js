// 1099 tax statements and the tax info lookups (mantle.other.TaxServices) over a new payer organization, a vendor and
// approved vendor invoices. New spec, no Groovy original.
const effectiveTime = Date.now()
let payerId, vendorId, yearPeriodId, statementId, allStatementId

spec({
    stepwise: true,
    tempSequences: { start: 56800, banks: { "mantle.party.Party": 10, "mantle.account.invoice.Invoice": 10,
        "mantle.party.time.TimePeriod": 30, "mantle.other.tax.TaxStatement": 10 } },
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(effectiveTime)
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

function vendorInvoice(items) {
    const invoiceId = call("mantle.account.InvoiceServices.create#Invoice", { fromPartyId: vendorId, toPartyId: payerId,
            invoiceTypeEnumId: "InvoiceSales", invoiceDate: effectiveTime - 3600000, currencyUomId: "USD" }).invoiceId
    for (const [itemTypeEnumId, amount] of items) {
        call("mantle.account.InvoiceServices.create#InvoiceItem", { invoiceId, itemTypeEnumId, quantity: 1, amount, description: itemTypeEnumId })
    }
    call("update#mantle.account.invoice.Invoice", { invoiceId, statusId: "InvoiceReceived" })
    call("update#mantle.account.invoice.Invoice", { invoiceId, statusId: "InvoiceApproved" })
    return invoiceId
}

feature("set up the payer, the vendor with an SSN and address, and approved vendor invoices", {
    when() {
        payerId = call("mantle.party.PartyServices.create#Organization", { organizationName: "Tax Payer Org", roleTypeId: "Supplier" }).partyId
        call("create#mantle.party.PartyRole", { partyId: payerId, roleTypeId: "OrgInternal" })
        call("mantle.ledger.LedgerServices.init#PartyAccountingConfiguration",
                { sourcePartyId: "DefaultSettings", organizationPartyId: payerId, startYear: String(new Date(effectiveTime).getUTCFullYear()) })
        call("create#mantle.party.PartyIdentification", { partyId: payerId, partyIdTypeEnumId: "PtidFein", idValue: "12-3456789" })
        call("mantle.party.ContactServices.store#PartyContactInfo", { partyId: payerId, postalContactMechPurposeId: "PostalTax",
                address1: "1 Payer Way", city: "Orem", stateProvinceGeoId: "USA_UT", postalCode: "84057", countryGeoId: "USA",
                telecomContactMechPurposeId: "PhoneTax", countryCode: "1", areaCode: "801", contactNumber: "555-0400" })
        vendorId = call("mantle.party.PartyServices.create#Person", { firstName: "Vic", lastName: "Vendor", roleTypeId: "Supplier" }).partyId
        call("create#mantle.party.PartyIdentification", { partyId: vendorId, partyIdTypeEnumId: "PtidSsn", idValue: "123-45-6789" })
        call("mantle.party.ContactServices.store#PartyContactInfo", { partyId: vendorId, postalContactMechPurposeId: "PostalPayment",
                address1: "9 Vendor Rd", city: "Provo", stateProvinceGeoId: "USA_UT", postalCode: "84601", countryGeoId: "USA" })
        const years = call("mantle.ledger.LedgerServices.get#OrganizationFiscalTimePeriods",
                { organizationPartyId: payerId, filterDate: ec.user.nowTimestamp, timePeriodTypeId: "FiscalYear" })
        yearPeriodId = years.timePeriodList[0].timePeriodId
        const invoiceIds = [vendorInvoice([["ItemExpServLabor", 700], ["ItemExpRoyalties", 50]]), vendorInvoice([["ItemExpLeaseOther", 125]])]
        return { invoiceIds }
    },
    then({ invoiceIds }) {
        yearPeriodId != null
        invoiceIds.length == 2
    },
})

feature("recipient and payer tax info", {
    when() {
        return { recipient: call("mantle.other.TaxServices.get#RecipientTaxInfo", { partyId: vendorId }),
                 payer: call("mantle.other.TaxServices.get#PayerTaxInfo", { partyId: payerId }) }
    },
    then({ recipient, payer }) {
        recipient.firstName == "Vic"
        recipient.lastName == "Vendor"
        recipient.ssn == "123-45-6789"
        recipient.homeStreetString.includes("9 Vendor Rd")
        recipient.homeCszString.includes("Provo")
        payer.name == "Tax Payer Org"
        payer.ein == "12-3456789"
        payer.addressString.includes("1 Payer Way")
    },
})

feature("1099-MISC form data splits the amounts by box", {
    when() {
        return { out: call("mantle.other.TaxServices.get#UsaIrs1099MiscFormData", { payerPartyId: payerId, recipientPartyId: vendorId,
                nonemployeeCompensation: 700, royalties: 50, rents: 125 }) }
    },
    then({ out }) {
        out.formMap["1099m_b"] == "12-3456789"
        out.formMap["1099m_c"] == "123-45-6789"
        out.formMap["1099m_d1"].includes("Vic Vendor")
        out.formMap["1099m_07"] == "700.00"
        out.formMap["1099m_02"] == "50.00"
        out.formMap["1099m_01"] == "125.00"
        out.formMap["1099m_03"] == null
    },
})

feature("create the Vendor 1099 statement from the invoices of the year", {
    when() {
        statementId = call("mantle.other.TaxServices.create#Vendor1099MiscStatement", { timePeriodId: yearPeriodId, partyId: vendorId }).taxStatementId
        const statement = ec.entity.find("mantle.other.tax.TaxStatement").condition("taxStatementId", statementId).one()
        const none = call("mantle.other.TaxServices.create#Vendor1099MiscStatement", { timePeriodId: yearPeriodId, partyId: payerId })
        return { statement, none }
    },
    then({ statement, none }) {
        statementId != null
        statement.timePeriodId == yearPeriodId
        statement.partyId == vendorId
        statement.formResponseId != null
        none.taxStatementId == null
    },
})

feature("create all the Vendor 1099 statements over a threshold, and delete a statement", {
    when() {
        const before = ec.entity.find("mantle.other.tax.TaxStatement").condition("timePeriodId", yearPeriodId).count()
        call("mantle.other.TaxServices.create#AllVendor1099MiscStatements", { timePeriodId: yearPeriodId, amountThreshold: 600 })
        const after = ec.entity.find("mantle.other.tax.TaxStatement").condition("timePeriodId", yearPeriodId).count()
        const high = call("mantle.other.TaxServices.create#AllVendor1099MiscStatements", { timePeriodId: yearPeriodId, amountThreshold: 100000 })
        const afterHigh = ec.entity.find("mantle.other.tax.TaxStatement").condition("timePeriodId", yearPeriodId).count()
        call("mantle.other.TaxServices.delete#TaxStatement", { taxStatementId: statementId })
        const gone = ec.entity.find("mantle.other.tax.TaxStatement").condition("taxStatementId", statementId).one()
        const missing = call("mantle.other.TaxServices.delete#TaxStatement", { taxStatementId: statementId })
        return { before, after, afterHigh, gone }
    },
    then({ before, after, afterHigh, gone }) {
        before == 1
        after == 2
        afterHigh == after
        gone == null
    },
})
