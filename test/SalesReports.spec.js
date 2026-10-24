// Sales summaries over the search index (mantle.sales.SalesReportServices) and the universal search service. They report
// "Search is not configured" without a search backend and are checked here for the shape they return either way.
// New spec, no Groovy original.
const effectiveTime = Date.now()
let searchAvailable

spec({
    stepwise: true,
    tempSequences: { start: 58700, banks: {} },
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(effectiveTime)
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

function errorOf(name, params) {
    try { call(name, params) } catch (e) { ec.message.clearErrors(); return String(e.message) }
    return null
}

feature("whether a search backend is available", {
    when() {
        searchAvailable = ec.search.isAvailable()
        return { searchAvailable }
    },
    then({ searchAvailable }) { searchAvailable === true || searchAvailable === false },
})

feature("sales order and invoice summaries return their lists, filtered by every list parameter", {
    when() {
        const common = { interval: "M", intervalCount: 3, maPeriods: 1 }
        const filters = { vendorPartyIds: ["ORG_ZIZI_RETAIL"], customerPartyIds: ["JoeDist"], productStoreIds: ["POPC_DEFAULT"], customerClassificationIds: ["CustDistributor"], productIds: ["DEMO_1_1"] }
        const plain = call("mantle.sales.SalesReportServices.get#SalesOrderSummary", common)
        const filtered = call("mantle.sales.SalesReportServices.get#SalesOrderSummary", Object.assign({}, common, filters))
        const weekly = call("mantle.sales.SalesReportServices.get#SalesOrderSummary", { interval: "w", intervalCount: 2 })
        const invoices = call("mantle.sales.SalesReportServices.get#SalesInvoiceSummary", Object.assign({}, common, { fromPartyIds: ["ORG_ZIZI_RETAIL"], toPartyIds: ["JoeDist"],
                productStoreIds: ["POPC_DEFAULT"], customerClassificationIds: ["CustDistributor"], productIds: ["DEMO_1_1"] }))
        return { plain, filtered, weekly, invoices }
    },
    then({ plain, filtered, weekly, invoices }) {
        if (searchAvailable) {
            // newest-first buckets are reversed, then the average and total lines follow
            plain.salesOrderSummaryList.length >= 2
            plain.salesOrderSummaryList[plain.salesOrderSummaryList.length - 1].dateKey == "Prior Total"
            plain.salesOrderSummaryList[plain.salesOrderSummaryList.length - 2].dateKey == "Prior Average"
            filtered.salesOrderSummaryList != null
            weekly.salesOrderSummaryList != null
            invoices.salesInvoiceSummaryList != null
        } else {
            plain.salesOrderSummaryList == null
            invoices.salesInvoiceSummaryList == null
        }
    },
})

feature("top products and invoices by customer class", {
    when() {
        const products = call("mantle.sales.SalesReportServices.get#SalesTopProduct", { interval: "M", topLimit: 5 })
        const classes = call("mantle.sales.SalesReportServices.get#InvoicesByCustomerClass", { interval: "y" })
        return { products, classes }
    },
    then({ products, classes }) {
        if (searchAvailable) {
            products.topProductList != null
            classes.topCustomerClassList != null
        } else {
            products.topProductList == null
            classes.topCustomerClassList == null
        }
    },
})

feature("universal search", {
    when() {
        const error = errorOf("mantle.search.UniversalSearchServices.search#Universal", { q: "Ziziwork" })
        let out = null
        if (searchAvailable) out = call("mantle.search.UniversalSearchServices.search#Universal", { q: "Ziziwork" })
        return { error, out }
    },
    then({ error, out }) {
        if (searchAvailable) {
            out.results != null
            out.capabilities != null
        } else {
            error.includes("Search is not configured")
        }
    },
})
