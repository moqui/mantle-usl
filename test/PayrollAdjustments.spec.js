// Payroll adjustments (taxes, deductions, garnishment, employer-paid) calculated and invoiced by process#TimePeriodPay
// for a salaried employee with a USA home address, plus the adjustment maintenance services. New spec, no Groovy original.
const effectiveTime = Date.now()
const year = new Date(effectiveTime).getUTCFullYear()
const day = (y, m, d) => Date.UTC(y, m - 1, d)
let yearId, orgId, employeeId, relId, monthId, socSecId, employerId, dedId, garnishId

spec({
    stepwise: true,
    tempSequences: { start: 57900, banks: { "mantle.party.Party": 10, "mantle.account.invoice.Invoice": 20, "mantle.party.time.TimePeriod": 60,
        "mantle.humanres.employment.PayrollAdjustment": 10, "mantle.humanres.employment.PayrollAdjustmentDetail": 10,
        "mantle.ledger.transaction.AcctgTrans": 60, "mantle.account.payment.Payment": 20 } },
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
function adjustment(fields, detail) {
    const out = call("mantle.humanres.PayrollServices.create#PayrollAdjustmentAndDetail", Object.assign({ organizationPartyId: orgId, fromDate: day(year, 1, 1),
            rateBasisEnumId: "PrbsGross" }, fields, detail))
    return out.payrollAdjustmentId
}

feature("set up a salaried employee with a USA home address and adjustments", {
    when() {
        orgId = call("mantle.party.PartyServices.create#Organization", { organizationName: "Payroll Tax Org", roleTypeId: "Supplier" }).partyId
        call("create#mantle.party.PartyRole", { partyId: orgId, roleTypeId: "OrgInternal" })
        call("mantle.ledger.LedgerServices.init#PartyAccountingConfiguration", { sourcePartyId: "DefaultSettings", organizationPartyId: orgId, startYear: String(year) })
        employeeId = call("mantle.party.PartyServices.create#Person", { firstName: "Tess", lastName: "Taxed", roleTypeId: "Employee" }).partyId
        call("create#mantle.humanres.employment.Employee", { partyId: employeeId })
        call("mantle.party.ContactServices.store#PartyContactInfo", { partyId: employeeId, postalContactMechPurposeId: "PostalHome", address1: "5 Home St", city: "Orem",
                stateProvinceGeoId: "USA_UT", postalCode: "84057", countryGeoId: "USA" })
        const position = call("create#mantle.humanres.position.EmplPosition", { organizationPartyId: orgId, emplPositionClassId: "Programmer", salaryFlag: "Y", fromDate: day(year - 1, 1, 1) }).emplPositionId
        relId = call("mantle.humanres.EmploymentServices.create#Employment", { fromPartyId: employeeId, toPartyId: orgId, fromDate: day(year - 1, 1, 1),
                emplPositionId: position, timePeriodTypeId: "PayrollMonth" }).partyRelationshipId
        call("mantle.humanres.EmploymentServices.create#EmploymentSalary", { partyRelationshipId: relId, amount: 5000, currencyUomId: "USD", fromDate: day(year - 1, 1, 1) })
        // a social security style tax (employee), the employer's share, a flat deduction, and a garnishment
        socSecId = adjustment({ description: "Test Social Security", taxAuthorityId: "UsaIrs", itemTypeEnumId: "ItemTaxSocialSecEmpe", payrollPhaseEnumId: "PrphTax",
                rateBasisEnumId: "PrbsSocial", isSocialTax: "Y", deductFromDisposable: "Y" }, { rate: "-0.062" })
        employerId = adjustment({ description: "Test Social Security Employer", taxAuthorityId: "UsaIrs", itemTypeEnumId: "ItemPrlExpTaxSocialSecEmpr", payrollPhaseEnumId: "PrphTax",
                rateBasisEnumId: "PrbsSocial", isSocialTax: "Y", isEmployerPaid: "Y" }, { rate: "-0.062" })
        dedId = adjustment({ description: "Test Deduction", itemTypeEnumId: "ItemDedMisc", payrollPhaseEnumId: "PrphDeductible", deductFromDisposable: "Y" }, { flatAmount: "-100" })
        garnishId = adjustment({ description: "Test Garnishment", itemTypeEnumId: "ItemDedWageGarnish", payrollPhaseEnumId: "PrphGarnish", payeePartyId: "ORG_ZIZI_RETAIL",
                garnishDisposablePercent: 25, garnishPriority: 1 }, { flatAmount: "-2000" })
        const refused = errorOf("mantle.humanres.PayrollServices.create#PayrollAdjustmentAndDetail", { organizationPartyId: orgId, itemTypeEnumId: "ItemDedMisc", isNegative: "Y", flatAmount: "10" })
        call("mantle.ledger.LedgerServices.check#NextFiscalTimePeriods", { organizationPartyId: orgId })
        call("mantle.humanres.EmploymentServices.check#NextPayrollTimePeriods", { organizationPartyId: orgId, basisDate: year + "-03-15" })
        monthId = Array.from(ec.entity.find("mantle.party.time.TimePeriod").condition("partyId", orgId).condition("timePeriodTypeId", "PayrollMonth")
                .condition("fromDate", "less-equals", year + "-03-15").condition("thruDate", "greater-equals", year + "-03-15").list())[0].timePeriodId
        return { refused }
    },
    then({ refused }) {
        [socSecId, employerId, dedId, garnishId].every(id => id != null)
        refused.includes("negative")
        monthId != null
    },
})

feature("the pay detail applies the adjustments in phase order and limits the garnishment", {
    when() { return { detail: call("mantle.humanres.PayrollServices.get#EmploymentPayDetail", { partyRelationshipId: relId, timePeriodId: monthId }) } },
    then({ detail }) {
        n(detail.payAmount) == 5000
        const byDesc = (d) => detail.adjustmentList.find(a => a.description == d)
        n(byDesc("Test Social Security").amount) == -310
        n(byDesc("Test Social Security Employer").amount) == -310
        n(byDesc("Test Deduction").amount) == -100
        // 25% of disposable pay (5000 - 310 - 100 = 4590) is 1147.50, less than the 2000 asked for
        n(byDesc("Test Garnishment").amount) == -1147.5
        // the employer's share does not reduce the employee's net pay
        n(detail.netPayAmount) == 5000 - 310 - 100 - 1147.5
        n(detail.socialTaxablePayAmount) == 5000
    },
})

feature("process the pay: employee, tax authority and payee invoices", {
    when() {
        const out = call("mantle.humanres.PayrollServices.process#TimePeriodPay", { timePeriodId: monthId, allowClosingBeforeEnd: true })
        const invoices = Array.from(ec.entity.find("mantle.account.invoice.Invoice").condition("timePeriodId", monthId).list())
        const pay = invoices.find(i => i.invoiceTypeEnumId == "InvoicePayroll")
        const items = Array.from(ec.entity.find("mantle.account.invoice.InvoiceItem").condition("invoiceId", pay.invoiceId).list())
        const tax = invoices.find(i => i.invoiceTypeEnumId == "InvoiceTax")
        const other = invoices.find(i => i.invoiceTypeEnumId == "InvoiceGarnishment" || i.invoiceTypeEnumId == "InvoicePayrollOther")
        const history = Array.from(ec.entity.find("mantle.humanres.employment.EmploymentPayHistory").condition("partyRelationshipId", relId).list())[0]
        const detailRows = Array.from(ec.entity.find("mantle.humanres.employment.EmploymentPayDetail").condition("partyRelationshipId", relId).list())
        return { out, pay, items, tax, other, history, detailRows, total: call("mantle.account.InvoiceServices.get#InvoiceTotal", { invoiceId: pay.invoiceId }) }
    },
    then({ out, pay, items, tax, other, history, detailRows, total }) {
        n(out.totalPayAmount) == 5000
        n(total.invoiceTotal) == 5000 - 310 - 100 - 1147.5
        items.length == 4
        tax != null
        other != null
        n(history.payAmount) == 5000
        detailRows.length == 4
    },
})

feature("update and delete an unused adjustment", {
    when() {
        const id = adjustment({ description: "Test Unused", itemTypeEnumId: "ItemDedMisc", payrollPhaseEnumId: "PrphDeductible" }, { flatAmount: "-50" })
        const detailSeqId = Array.from(ec.entity.find("mantle.humanres.employment.PayrollAdjustmentDetail").condition("payrollAdjustmentId", id).list())[0].detailSeqId
        call("mantle.humanres.PayrollServices.update#PayrollAdjustmentAndDetail", { payrollAdjustmentId: id, detailSeqId, description: "Test Unused edited", flatAmount: "-150" })
        const edited = ec.entity.find("mantle.humanres.employment.PayrollAdjustment").condition("payrollAdjustmentId", id).one()
        const detail = ec.entity.find("mantle.humanres.employment.PayrollAdjustmentDetail").condition("payrollAdjustmentId", id).one()
        call("mantle.humanres.PayrollServices.delete#PayrollAdjustmentAndDetail", { payrollAdjustmentId: id, detailSeqId })
        const gone = ec.entity.find("mantle.humanres.employment.PayrollAdjustment").condition("payrollAdjustmentId", id).one()
        // an adjustment already used by a pay run cannot be deleted
        const used = errorOf("mantle.humanres.PayrollServices.delete#PayrollAdjustmentAndDetail", { payrollAdjustmentId: dedId, detailSeqId: "01" })
        return { edited, detail, gone, used }
    },
    then({ edited, detail, gone, used }) {
        edited.description == "Test Unused edited"
        n(detail.flatAmount) == -150
        gone == null
        used != null
    },
})

feature("workers comp rates and garnishment details", {
    when() {
        const wcId = call("mantle.humanres.PayrollServices.create#WorkersCompRate", { organizationPartyId: orgId, description: "Test WC", itemTypeEnumId: "ItemPrlExp401kEmpr",
                payrollPhaseEnumId: "PrphTax", rateBasisEnumId: "PrbsGross", riskClassEnumId: "RcTest", isEmployerPaid: "Y", fromDate: day(year, 1, 1), rate: "-0.01" }).payrollAdjustmentId
        const created = ec.entity.find("mantle.humanres.employment.PayrollAdjustmentDetail").condition("payrollAdjustmentId", wcId).list()
        const detailSeqId = created[0].detailSeqId
        call("mantle.humanres.PayrollServices.update#WorkersCompRate", { payrollAdjustmentId: wcId, detailSeqId, rate: "-0.02" })
        const updated = ec.entity.find("mantle.humanres.employment.PayrollAdjustmentDetail").condition("payrollAdjustmentId", wcId).one()
        call("mantle.humanres.PayrollServices.delete#WorkersCompRate", { payrollAdjustmentId: wcId, detailSeqId })
        const wcGone = ec.entity.find("mantle.humanres.employment.PayrollAdjustment").condition("payrollAdjustmentId", wcId).one()
        // garnishment details: another detail row on the garnishment, then change it
        call("mantle.humanres.PayrollServices.create#GarnishmentDetail", { payrollAdjustmentId: garnishId, detailSeqId: "99", flatAmount: "-500" })
        call("mantle.humanres.PayrollServices.update#GarnishmentDetail", { payrollAdjustmentId: garnishId, detailSeqId: "99", flatAmount: "-600" })
        const garnish = ec.entity.find("mantle.humanres.employment.PayrollAdjustmentDetail").condition("payrollAdjustmentId", garnishId).condition("detailSeqId", "99").one()
        return { created, updated, wcGone, garnish }
    },
    then({ created, updated, wcGone, garnish }) {
        created.length == 1
        n(updated.rate) == -0.02
        wcGone == null
        n(garnish.flatAmount) == -600
    },
})

feature("employment and wage-and-tax info for the tax year", {
    when() {
        call("create#mantle.party.PartyIdentification", { partyId: orgId, partyIdTypeEnumId: "PtidFein", idValue: "98-7654321" })
        call("create#mantle.party.PartyIdentification", { partyId: employeeId, partyIdTypeEnumId: "PtidSsn", idValue: "123-45-6789" })
        call("mantle.party.ContactServices.store#PartyContactInfo", { partyId: orgId, postalContactMechPurposeId: "PostalTax", address1: "1 Payer Way", city: "Orem",
                stateProvinceGeoId: "USA_UT", postalCode: "84057", countryGeoId: "USA", telecomContactMechPurposeId: "PhoneTax", countryCode: "1", areaCode: "801", contactNumber: "555-0400" })
        yearId = call("mantle.ledger.LedgerServices.get#OrganizationFiscalTimePeriods", { organizationPartyId: orgId, filterDate: ec.user.nowTimestamp,
                timePeriodTypeId: "FiscalYear" }).timePeriodList[0].timePeriodId
        const info = call("mantle.humanres.PayrollDocumentServices.get#EmploymentInfo", { timePeriodId: yearId, partyRelationshipId: relId })
        const wage = call("mantle.humanres.PayrollDocumentServices.get#EmploymentWageAndTaxInfo", { timePeriodId: yearId, partyRelationshipId: relId })
        return { info, wage }
    },
    then({ info, wage }) {
        info.employeeFirstName == "Tess"
        info.employeeSsn == "123-45-6789"
        info.employerName == "Payroll Tax Org"
        info.employerEin == "98-7654321"
        info.employerAddressString.includes("1 Payer Way")
        info.employerPhoneString == "1-801-555-0400"
        wage.hasAnyPay
        n(wage.taxablePayAmount) >= 0
        n(wage.socialTaxablePayAmount) == 5000
        // the test adjustments name the federal authority; the social tax withheld is the employee share
        n(wage.wageAndTaxInfoByTaxAuthorityId["UsaIrs"].socialTaxWithheldAmount) == 310
        wage.federalTaxAuthorityIdList.includes("UsaIrs")
    },
})

feature("W-2 form data, wage and tax records for the year, and the EFW2 file", {
    when() {
        const form = call("mantle.humanres.PayrollDocumentServices.get#UsaIrsW2FormData", { timePeriodId: yearId, partyRelationshipId: relId })
        const created = call("mantle.humanres.PayrollDocumentServices.create#PeriodWageAndTaxRecords", { timePeriodId: yearId })
        const statements = Array.from(ec.entity.find("mantle.other.tax.TaxStatement").condition("timePeriodId", yearId).list())
        const period = ec.entity.find("mantle.party.time.TimePeriod").condition("timePeriodId", yearId).one()
        return { form, created, statements, period }
    },
    then({ form, statements, period }) {
        form.formId == "UsaIrsW2"
        form.formMap.w2_b == "98-7654321"
        form.formMap.w2_a == "123-45-6789"
        statements.length == 1
        statements[0].partyId == employeeId
        statements[0].formResponseId != null
        period.isClosed == "Y"
    },
})

// generate#Efw2File is unfinished upstream: it builds the RA, RE, RW and RS records but never the RT, RU, RV and RF totals,
// and never sets its fileText output, so this checks it runs through the employee and employer lookups for the closed year.
feature("generate an EFW2 file for the closed year runs", {
    when() {
        const out = call("mantle.humanres.PayrollDocumentServices.generate#Efw2File", { timePeriodId: yearId, submitterPartyId: orgId })
        return { out }
    },
    then({ out }) {
        out != null
    },
})

feature("1099-MISC form data for the same employment and a payroll invoice made by hand", {
    when() {
        const form = call("mantle.humanres.PayrollDocumentServices.get#UsaIrs1099MiscFormData", { timePeriodId: yearId, partyRelationshipId: relId })
        const created = call("mantle.humanres.PayrollServices.create#PayrollInvoice", { partyRelationshipId: relId, invoiceTypeEnumId: "InvoicePayroll", invoiceDate: effectiveTime - 3600000 })
        const invoice = ec.entity.find("mantle.account.invoice.Invoice").condition("invoiceId", created.invoiceId).one()
        return { form, created, invoice }
    },
    then({ form, invoice }) {
        form.formId == "UsaIrs1099Misc"
        form.formMap["1099m_b"] == "98-7654321"
        form.formMap["1099m_c"] == "123-45-6789"
        form.formMap["1099m_d1"].includes("Tess")
        // the employee is the invoice's from party, the organization is internal: payroll invoices are from the employer to the employee
        invoice.statusId == "InvoiceInProcess" || invoice.statusId == "InvoiceIncoming"
        invoice.currencyUomId == "USD"
    },
})
