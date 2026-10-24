// Time period maintenance (mantle.party.TimeServices): grouping, previous and next periods, resetting names and deleting
// periods. Uses the fiscal periods of a new organization. New spec, no Groovy original.
const effectiveTime = Date.now()
const year = new Date(effectiveTime).getUTCFullYear()
let orgId, monthIds, firstMonth, newPreviousId, extraId

spec({
    stepwise: true,
    tempSequences: { start: 58400, banks: { "mantle.party.Party": 10, "mantle.party.time.TimePeriod": 80 } },
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(effectiveTime)
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

const period = (id) => ec.entity.find("mantle.party.time.TimePeriod").condition("timePeriodId", id).one()
const periods = (typeId) => Array.from(ec.entity.find("mantle.party.time.TimePeriod").condition("partyId", orgId).condition("timePeriodTypeId", typeId).orderBy("fromDate").list())

feature("a new organization has fiscal months", {
    when() {
        orgId = call("mantle.party.PartyServices.create#Organization", { organizationName: "Time Period Org", roleTypeId: "Supplier" }).partyId
        call("create#mantle.party.PartyRole", { partyId: orgId, roleTypeId: "OrgInternal" })
        call("mantle.ledger.LedgerServices.init#PartyAccountingConfiguration", { sourcePartyId: "DefaultSettings", organizationPartyId: orgId, startYear: String(year) })
        monthIds = periods("FiscalMonth").map(p => p.timePeriodId)
        firstMonth = periods("FiscalMonth")[0]
        return { count: monthIds.length }
    },
    then({ count }) { count >= 12 },
})

feature("find#PartyTimePeriodGroups: the most recent periods, alone and with the ones before each", {
    when() {
        const thruDate = year + "-12-31"
        const single = call("mantle.party.TimeServices.find#PartyTimePeriodGroups", { partyId: orgId, groups: 3, thruDate })
        const trailing = call("mantle.party.TimeServices.find#PartyTimePeriodGroups", { partyId: orgId, groups: 3, perGroup: 2, thruDate })
        return { single, trailing }
    },
    then({ single, trailing }) {
        single.timePeriodGroups.length == 3
        single.timePeriodGroups.every(g => g.length == 1)
        // ascending by from date, the last being December
        single.timePeriodGroups[2][0] == monthIds[11]
        single.timePeriodGroups[0][0] == monthIds[9]
        trailing.timePeriodGroups.length == 3
        trailing.timePeriodGroups.every(g => g.length == 2)
        trailing.timePeriodGroups[2][0] == monthIds[10]
        trailing.timePeriodGroups[2][1] == monthIds[11]
    },
})

feature("get and create the previous and next periods", {
    when() {
        const next = call("mantle.party.TimeServices.get#NextTimePeriod", { timePeriodId: monthIds[0] })
        const lastNext = call("mantle.party.TimeServices.get#NextTimePeriod", { timePeriodId: monthIds[monthIds.length - 1] })
        const prev = call("mantle.party.TimeServices.getOrCreate#PreviousTimePeriod", { timePeriodId: monthIds[0] })
        newPreviousId = prev.previousTimePeriodId
        const prevAgain = call("mantle.party.TimeServices.getOrCreate#PreviousTimePeriod", { timePeriodId: monthIds[0] })
        const nextCreated = call("mantle.party.TimeServices.getOrCreate#NextTimePeriod", { timePeriodId: monthIds[monthIds.length - 1] })
        extraId = nextCreated.nextTimePeriodId
        return { next, lastNext, prev, prevAgain, nextCreated, first: period(monthIds[0]), created: period(newPreviousId), extra: period(extraId) }
    },
    then({ next, lastNext, prevAgain, first, created, extra }) {
        next.nextTimePeriodId == monthIds[1]
        newPreviousId != null
        prevAgain.previousTimePeriodId == newPreviousId
        first.previousPeriodId == newPreviousId
        created.timePeriodTypeId == "FiscalMonth"
        extra.previousPeriodId == monthIds[monthIds.length - 1]
    },
})

feature("getOrCreate#TimePeriod finds an existing period by its from date and creates a missing one", {
    when() {
        const existing = call("mantle.party.TimeServices.getOrCreate#TimePeriod", { partyId: orgId, timePeriodTypeId: "FiscalMonth", fromDate: year + "-03-01" })
        const quarter = call("mantle.party.TimeServices.getOrCreate#TimePeriod", { partyId: orgId, timePeriodTypeId: "FiscalQuarter", fromDate: (year + 3) + "-01-01" })
        return { existing, quarter, created: period(quarter.timePeriodId) }
    },
    then({ existing, quarter, created }) {
        existing.timePeriodId == monthIds[2]
        quarter.timePeriodId != null
        created.partyId == orgId
        created.periodName != null
    },
})

feature("reset#TimePeriodNames renames the periods from the name template", {
    when() {
        call("update#mantle.party.time.TimePeriod", { timePeriodId: monthIds[3], periodName: "Hand edited name" })
        const edited = period(monthIds[3]).periodName
        call("mantle.party.TimeServices.reset#TimePeriodNames", { partyId: orgId, timePeriodTypeId: "FiscalMonth" })
        return { edited, reset: period(monthIds[3]).periodName, other: period(monthIds[4]).periodName }
    },
    then({ edited, reset, other }) {
        edited == "Hand edited name"
        reset != "Hand edited name"
        reset.length > 0
        other.length > 0
    },
})

feature("delete#TimePeriod refuses periods with a next period or that are closed, and deletes a free one", {
    when() {
        const hasNext = call("mantle.party.TimeServices.delete#TimePeriod", { timePeriodId: monthIds[5] })
        const stillThere = period(monthIds[5])
        call("update#mantle.party.time.TimePeriod", { timePeriodId: extraId, isClosed: "Y" })
        const closed = call("mantle.party.TimeServices.delete#TimePeriod", { timePeriodId: extraId })
        const closedStill = period(extraId)
        call("update#mantle.party.time.TimePeriod", { timePeriodId: extraId, isClosed: "N" })
        call("mantle.party.TimeServices.delete#TimePeriod", { timePeriodId: extraId })
        return { stillThere, closedStill, gone: period(extraId) }
    },
    then({ stillThere, closedStill, gone }) {
        stillThere != null
        closedStill != null
        gone == null
    },
})
