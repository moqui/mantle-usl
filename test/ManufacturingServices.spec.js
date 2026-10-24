// Production runs (mantle.work.ManufacturingServices): a run that produces DEMO_1_1 from its BOM components, issuing
// components, producing the assembly, breaking it down, unissuing and cancelling. New spec, no Groovy original.
const effectiveTime = Date.now()
const facilityId = "ZIRET_WH", ownerPartyId = "ORG_ZIZI_RETAIL"
let runId, secondRunId

spec({
    stepwise: true,
    tempSequences: { start: 57800, banks: { "mantle.work.effort.WorkEffort": 20, "mantle.product.asset.Asset": 30, "mantle.product.asset.AssetDetail": 100,
        "mantle.product.issuance.AssetIssuance": 20, "mantle.product.receipt.AssetReceipt": 10, "mantle.ledger.transaction.AcctgTrans": 60 } },
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
const we = (id) => ec.entity.find("mantle.work.effort.WorkEffort").condition("workEffortId", id).one()
const wep = (id, type) => Array.from(ec.entity.find("mantle.work.effort.WorkEffortProduct").condition("workEffortId", id).condition("typeEnumId", type).list())

feature("the BOM of a product", {
    when() {
        const bom = call("mantle.work.ManufacturingServices.get#ProductBomDetail", { productId: "DEMO_1_1", produceQuantity: 2 })
        return { bom }
    },
    then({ bom }) {
        bom.bomDetailList.length >= 1
    },
})

feature("create a production run that consumes the BOM and produces the assembly", {
    when() {
        // components for the run
        for (const component of ["DEMO_SA_1", "DEMO_SA_2", "DEMO_RM_1"]) {
            call("mantle.product.AssetServices.receive#Asset", { productId: component, quantity: 100, facilityId, ownerPartyId, assetTypeEnumId: "AstTpInventory", receivedDate: effectiveTime })
        }
        runId = call("mantle.work.ManufacturingServices.create#ProductionRun", { workEffortName: "Run 1", facilityId, originFacilityId: facilityId,
                produceProductId: "DEMO_1_1", produceEstimatedQuantity: 5, estimatedStartDate: effectiveTime }).workEffortId
        return { consume: wep(runId, "WeptConsume"), produce: wep(runId, "WeptProduce"), run: we(runId) }
    },
    then({ consume, produce, run }) {
        consume.length >= 1
        produce.length == 1
        n(produce[0].estimatedQuantity) == 5
        run.purposeEnumId == "WepProductionRun"
    },
})

feature("change the quantity produced and recreate the consume list", {
    when() {
        call("mantle.work.ManufacturingServices.set#ProducedProductQuantity", { workEffortId: runId, productId: "DEMO_1_1", estimatedQuantity: 8 })
        call("mantle.work.ManufacturingServices.recreate#ConsumeProductsFromProduce", { workEffortId: runId })
        const detail = call("mantle.work.ManufacturingServices.get#ProductionRunProduceConsumeDetail", { workEffortId: runId })
        return { produce: wep(runId, "WeptProduce"), consume: wep(runId, "WeptConsume"), detail }
    },
    then({ produce, consume, detail }) {
        n(produce[0].estimatedQuantity) == 8
        consume.length >= 1
        detail.produceBomDetailList != null
    },
})

feature("display info, pick info and what can still be consumed", {
    when() {
        const display = call("mantle.work.ManufacturingServices.get#ProductionRunDisplayInfo", { workEffortId: runId })
        const pick = call("mantle.work.ManufacturingServices.get#ProductionRunPickInfo", { workEffortId: runId })
        const remaining = call("mantle.work.ManufacturingServices.get#ConsumedAssetRemaining", { workEffortId: runId })
        const complete = call("mantle.work.ManufacturingServices.get#ProducedProductComplete", { workEffortId: runId })
        return { display, pick, remaining, complete }
    },
    then({ display, pick, remaining, complete }) {
        display.workEffort.workEffortId == runId
        pick.workEffort.workEffortId == runId
        remaining != null
        complete.allEstimatedProduced == false
    },
})

feature("issue the components to the run", {
    when() {
        const consume = wep(runId, "WeptConsume")
        const issued = []
        for (const c of consume) {
            const out = call("mantle.product.AssetServices.issue#AnyAssetToWorkEffort", { productId: c.productId, facilityId, workEffortId: runId, quantity: n(c.estimatedQuantity) })
            issued.push(out.assetIdList.length)
        }
        const one = call("mantle.product.AssetServices.issue#AssetToWorkEffort", { assetId: Array.from(ec.entity.find("mantle.product.asset.Asset").condition("productId", consume[0].productId).condition("facilityId", facilityId).list())[0].assetId,
                workEffortId: runId, quantity: 1 })
        const issuances = Array.from(ec.entity.find("mantle.product.issuance.AssetIssuance").condition("workEffortId", runId).list())
        return { issued, issuances: issuances.length }
    },
    then({ issued, issuances }) {
        issuances >= 1
        issued.length >= 1
    },
})

feature("unissue a component and the assembly components, then cancel the run", {
    when() {
        const consume = wep(runId, "WeptConsume")
        call("mantle.work.ManufacturingServices.unissue#Component", { workEffortId: runId, componentProductId: consume[0].productId, componentQuantity: 1 })
        call("mantle.work.ManufacturingServices.unissue#AssemblyComponents", { workEffortId: runId, assemblyProductId: "DEMO_1_1", assemblyQuantity: 1 })
        call("mantle.work.ManufacturingServices.cancel#AssemblyWorkEffort", { workEffortId: runId })
        return { status: we(runId).statusId }
    },
    then({ status }) { status == "WeCancelled" },
})

feature("break down a produced assembly, reducing what the run produced", {
    when() {
        secondRunId = call("mantle.work.ManufacturingServices.create#ProductionRun", { workEffortName: "Run 2", facilityId, originFacilityId: facilityId,
                produceProductId: "DEMO_1_1", produceEstimatedQuantity: 3, estimatedStartDate: effectiveTime }).workEffortId
        const assetId = call("mantle.product.AssetServices.receive#Asset", { productId: "DEMO_1_1", quantity: 3, facilityId, ownerPartyId, assetTypeEnumId: "AstTpInventory",
                workEffortId: secondRunId, receivedDate: effectiveTime }).assetId
        const tooMany = errorOf("mantle.work.ManufacturingServices.breakDown#Assembly", { assetId, workEffortId: secondRunId, quantityToBreakDown: 10 })
        const out = call("mantle.work.ManufacturingServices.breakDown#Assembly", { assetId, workEffortId: secondRunId, quantityToBreakDown: 2 })
        const receipts = Array.from(ec.entity.find("mantle.product.receipt.AssetReceipt").condition("assetId", assetId).condition("workEffortId", secondRunId).list())
        const asset = ec.entity.find("mantle.product.asset.Asset").condition("assetId", assetId).one()
        return { tooMany, out, receipts, asset }
    },
    then({ tooMany, out, receipts, asset }) {
        tooMany.includes("is more than Asset")
        n(out.quantityBrokenDown) == 2
        receipts.length >= 1
        n(receipts.reduce((sum, r) => sum + n(r.quantityAccepted), 0)) == 1
        n(asset.quantityOnHandTotal) == 1
    },
})
