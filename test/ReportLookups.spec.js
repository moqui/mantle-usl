// Lookup and report services: lookup by id, filtered search, feature interactions, measurement units, projected
// inventory, price history and budget item details. New spec, no Groovy original.
const effectiveTime = Date.now()
let featureAId, featureBId, featureCId

spec({
    stepwise: true,
    tempSequences: { start: 59300, banks: { "mantle.product.feature.ProductFeature": 10 } },
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

feature("lookup by an id finds the record of each kind", {
    when() {
        const none = call("mantle.GeneralServices.lookup#ById", {})
        const party = call("mantle.GeneralServices.lookup#ById", { lookupId: "ORG_ZIZI_RETAIL" })
        const product = call("mantle.GeneralServices.lookup#ById", { lookupId: "DEMO_1_1" })
        const facility = call("mantle.GeneralServices.lookup#ById", { lookupId: "ZIRET_WH" })
        const unknown = call("mantle.GeneralServices.lookup#ById", { lookupId: "NO-SUCH-ID-ANYWHERE" })
        return { none, party, product, facility, unknown }
    },
    then({ none, party, product, facility, unknown }) {
        none.partyId == null
        party.partyId == "ORG_ZIZI_RETAIL"
        party.party.partyId == "ORG_ZIZI_RETAIL"
        product.productId == "DEMO_1_1"
        facility.facilityId == "ZIRET_WH"
        unknown.partyId == null
        unknown.productId == null
        unknown.facilityId == null
    },
})

feature("filtered search over the mantle index", {
    when() {
        const out = call("mantle.GeneralServices.search#MantleFiltered", { indexName: "mantle", queryString: "Ziziwork", documentType: "MantleParty" })
        const general = call("mantle.GeneralServices.search#MantleFiltered", { indexName: "mantle", queryString: "DEMO" })
        return { out, general }
    },
    then({ out, general }) {
        out != null
        general != null
    },
})

feature("compatible product features, found by the interaction or all of a type", {
    when() {
        const type = "PftColor"
        featureAId = call("create#mantle.product.feature.ProductFeature", { productFeatureTypeEnumId: type, description: "Interact Red" }).productFeatureId
        featureBId = call("create#mantle.product.feature.ProductFeature", { productFeatureTypeEnumId: "PftSize", description: "Interact Large" }).productFeatureId
        featureCId = call("create#mantle.product.feature.ProductFeature", { productFeatureTypeEnumId: "PftSize", description: "Interact Small" }).productFeatureId
        call("create#mantle.product.feature.ProductFeatureIactn", { productFeatureId: featureAId, toProductFeatureId: featureBId, iactnTypeEnumId: "PfitCompatible" })
        const forward = call("mantle.product.ProductServices.get#FeatureByIactnOrAll", { productFeatureId: featureAId, productFeatureTypeEnumId: "PftSize" })
        const reverse = call("mantle.product.ProductServices.get#FeatureByIactnOrAll", { productFeatureId: featureBId, findByTo: true, productFeatureTypeEnumId: "PftColor" })
        const wrongType = call("mantle.product.ProductServices.get#FeatureByIactnOrAll", { productFeatureId: featureAId, productFeatureTypeEnumId: "PftColor" })
        return { forward, reverse, wrongType }
    },
    then({ forward, reverse, wrongType }) {
        forward.resultList.length == 1
        forward.resultList[0].productFeatureId == featureBId
        reverse.resultList.length == 1
        reverse.resultList[0].productFeatureId == featureAId
        // none of the color type is compatible with it, so all the colors come back
        wrongType.resultList.some(f => f.productFeatureId == featureAId)
    },
})

feature("measurement units for a measurement type", {
    when() {
        const types = Array.from(ec.entity.find("mantle.work.measurement.MeasurementType").list())
        const out = call("mantle.work.MeasurementServices.get#MeasurementUomsByMeasurementType", { measurementTypeId: types.length ? types[0].measurementTypeId : "NONE" })
        return { count: types.length, out }
    },
    then({ out }) {
        out.resultList.length >= 1
        out.resultList[0].value != null
        out.resultList[0].label != null
    },
})

feature("projected inventory and price history", {
    when() {
        const projected = call("mantle.product.InventoryReportServices.get#InventoryProjectedInfo", { productIdList: ["DEMO_1_1", "DEMO_2_1"], facilityId: "ZIRET_WH" })
        const history = call("mantle.product.InventoryReportServices.get#PriceHistoryInfo", { productIdList: ["DEMO_1_1"], fromDate: effectiveTime - 365 * 86400000 })
        return { projected, history }
    },
    then({ projected, history }) {
        projected.infoByProductId != null
        history.infoByProductId != null
    },
})
