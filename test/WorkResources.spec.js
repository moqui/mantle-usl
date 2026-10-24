// IronStone Projects resources in mantle.work.ResourceServices (design-projects.md §9 and §15 Capacity and Allocations; impl-projects.md
// P7): capacity from a person's WetAvailable working hours or the timesheet policy's week, less the organization's holidays and the
// person's leave (get#PartyCapacity, and get#WeekDays with a person, which MyTime and Timesheets read); a manager's request of a
// placeholder (create#Allocation: Requested, the AllocationRequest notice to the approvers), who may see and change it
// (get#AllocationAccess), the staffing candidates ranked by fit, skill and role (find#StaffingCandidates), staffing that allocates
// (staff#Allocation, the AllocationDecision notice), an allocation at a percent, an over-allocated week and assigned work in the team
// plan (get#TeamPlan), reject with a reason and cancel, the lists of find#Allocations with their counts, and Home's allocation
// requests (get#ProjectHomeCounts). New spec, no Groovy original.
// In a Work group project of its own (RSW: john.doe, ADMIN, an approver; joe.developer its project manager, who requests), with two
// people of its own: Pat (Monday to Thursday, 6 hours a day, a UI designer with the skill) and Sam (the policy's week, a day of leave
// and a holiday in the first week). Weeks of February 2027.
const RS = "mantle.work.ResourceServices"
const TS = "mantle.work.TimesheetServices"
const PROJECT = "mantle.work.ProjectServices"
// a moment of a day in the session's time zone
const at = (day, hour) => Number(String(ec.l10n.parseTimestamp(`${day} ${String(hour).padStart(2, "0")}:00:00.000`, "yyyy-MM-dd HH:mm:ss.SSS")))
const made = {}
const NOW = () => at("2027-01-27", 9)

spec({
    stepwise: true,
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(NOW())
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() {
        ec.artifactExecution.enableAuthz()
        login("john.doe")
        ec.user.setEffectiveTime(NOW())
    },
    cleanupSpec() {
        ec.artifactExecution.disableAuthz()
        try {
            // the holiday would otherwise count in other specs' weeks
            const holiday = ec.entity.find("mantle.work.effort.WorkEffort").condition("workEffortId", "RSW_HOLIDAY").one()
            if (holiday) holiday.delete()
            const project = ec.entity.find("mantle.work.effort.WorkEffort").condition("workEffortId", "RSW").one()
            if (project) { project.statusId = "WeCancelled"; project.update() }
        } finally { ec.artifactExecution.enableAuthz() }
        ec.user.setEffectiveTime(null)
    },
})

function errorOf(name, params) {
    try { call(name, params) } catch (e) { ec.message.clearErrors(); return String(e.message) }
    const errors = ec.message.getErrorsString ? ec.message.getErrorsString() : null
    ec.message.clearErrors()
    return errors || null
}
// as another user: the services decide by the user, authorization stays off (the screens' app roots grant the services)
function as(username, run) {
    login(username)
    ec.user.setEffectiveTime(NOW())
    try { return run() } finally { login("john.doe"); ec.user.setEffectiveTime(NOW()) }
}
const all = (entityName, fields) => Array.from(ec.entity.find(entityName).condition(fields).list())
const one = (entityName, fields) => ec.entity.find(entityName).condition(fields).one()
const weekOf = (person, weekStart) => Array.from(person.weekList).find((week) => week.weekStart == weekStart)
const usersOf = (message) => all("moqui.security.user.NotificationMessageUser", { notificationMessageId: message.notificationMessageId }).map((row) => row.userId)
const messagesOf = (topic, id) => all("moqui.security.user.NotificationMessage", { topic, recordEntityName: "mantle.work.effort.WorkEffortAllocation", recordId: id })

feature("people's capacity: their own working hours, else the policy's week, less a holiday and leave; get#WeekDays reads it for a person", {
    when() {
        call(`${PROJECT}.create#Project`, { workEffortId: "RSW", workEffortName: "Resource walk", visibilityEnumId: "WevWorkGroup" })
        call("update#mantle.work.effort.WorkEffort", { workEffortId: "RSW", statusId: "WeInProgress", ownerPartyId: "ORG_ZIZI_SERVICES" })
        for (const [partyId, firstName] of [["RSW_PAT", "Pat"], ["RSW_SAM", "Sam"]]) {
            call("create#mantle.party.Party", { partyId, partyTypeEnumId: "PtyPerson" })
            call("create#mantle.party.Person", { partyId, firstName, lastName: "Planner" })
        }
        for (const [partyId, roleTypeId] of [["EX_JOHN_DOE", "Manager"], ["ORG_ZIZI_JD", "ProjectManager"], ["RSW_PAT", "UiDesigner"], ["RSW_SAM", "Programmer"]])
            call("create#mantle.work.effort.WorkEffortParty", { workEffortId: "RSW", partyId, roleTypeId, fromDate: at("2027-01-01", 0), statusId: "WeptAssigned" })
        call("create#moqui.basic.Enumeration", { enumId: "RswSkDesign", enumTypeId: "SkillType", description: "Design (resource walk)" })
        call("create#mantle.humanres.ability.PartySkill", { partyId: "RSW_PAT", skillTypeEnumId: "RswSkDesign", rating: 4 })
        // Pat: Monday to Thursday, 9 to 15
        const hours = call("create#mantle.work.effort.WorkEffort", { workEffortTypeEnumId: "WetAvailable", workEffortName: "Working hours", statusId: "WeApproved",
            ownerPartyId: "RSW_PAT", timeUomId: "TF_hr", estimatedStartDate: at("2027-01-04", 9), estimatedCompletionDate: at("2027-01-04", 15), estimatedWorkDuration: 6 }).workEffortId
        call("create#mantle.work.effort.WorkEffortParty", { workEffortId: hours, partyId: "RSW_PAT", roleTypeId: "Assignee", fromDate: at("2027-01-01", 0), statusId: "WeptAssigned" })
        call("create#mantle.work.effort.WorkEffortRecurrence", { workEffortId: hours, rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH" })
        // Sam: a day of leave on Wednesday the 3rd; the organization's holiday on Friday the 5th
        const leave = call("create#mantle.work.effort.WorkEffort", { workEffortTypeEnumId: "WetTimeOff", workEffortName: "Day off", statusId: "WeApproved",
            ownerPartyId: "RSW_SAM", allDayStart: "2027-02-03", estimatedStartDate: at("2027-02-03", 0), estimatedCompletionDate: at("2027-02-04", 0) }).workEffortId
        call("create#mantle.work.effort.WorkEffortParty", { workEffortId: leave, partyId: "RSW_SAM", roleTypeId: "Assignee", fromDate: at("2027-01-01", 0), statusId: "WeptAssigned" })
        call("create#mantle.work.effort.WorkEffort", { workEffortId: "RSW_HOLIDAY", workEffortTypeEnumId: "WetEvent", purposeEnumId: "WepHoliday", workEffortName: "Founders' day",
            ownerPartyId: "ORG_ZIZI_SERVICES", allDayStart: "2027-02-05" })
        const policy = call(`${TS}.get#TimesheetPolicy`, { partyId: "RSW_SAM" })
        made.policyOrg = policy.organizationPartyId
        const capacity = call(`${RS}.get#PartyCapacity`, { partyIdList: ["RSW_PAT", "RSW_SAM"], fromDate: "2027-02-01", thruDate: "2027-02-14" }).capacityList
        const days = ["2027-02-01", "2027-02-02", "2027-02-03", "2027-02-04", "2027-02-05", "2027-02-06", "2027-02-07"]
        const weekDays = call(`${TS}.get#WeekDays`, { dayList: days, policy: policy.policy, organizationPartyId: policy.organizationPartyId, partyId: "RSW_SAM" })
        const noPerson = call(`${TS}.get#WeekDays`, { dayList: days, policy: policy.policy, organizationPartyId: policy.organizationPartyId })
        return { capacity, weekDays, noPerson }
    },
    then({ capacity, weekDays, noPerson }) {
        made.policyOrg == "ORG_ZIZI_SERVICES"
        const pat = capacity.find((entry) => entry.partyId == "RSW_PAT")
        const sam = capacity.find((entry) => entry.partyId == "RSW_SAM")
        pat.source == "available"
        weekOf(pat, "2027-02-01").base == 24
        weekOf(pat, "2027-02-01").capacity == 24
        pat.dayList.find((day) => day.day == "2027-02-05").base == 0
        sam.source == "policy"
        weekOf(sam, "2027-02-01").base == 40
        weekOf(sam, "2027-02-01").holidayHours == 8
        weekOf(sam, "2027-02-01").leaveHours == 8
        weekOf(sam, "2027-02-01").capacity == 24
        weekOf(sam, "2027-02-08").capacity == 40
        sam.capacity == 64
        weekDays.expectedTotal == 24
        weekDays.weekDayList.find((day) => day.day == "2027-02-03").leave == 8
        weekDays.weekDayList.find((day) => day.day == "2027-02-05").holiday == "Founders' day"
        weekDays.weekDayList.find((day) => day.day == "2027-02-05").isWorkday == false
        noPerson.expectedTotal == 32
    },
})

feature("joe, the project's manager, requests a placeholder: it is Requested and the approvers get AllocationRequest; joe may not approve it, bob may not see it", {
    when() {
        const out = as("joe.developer", () => call(`${RS}.create#Allocation`, { workEffortId: "RSW", roleTypeId: "UiDesigner", skillTypeEnumId: "RswSkDesign",
            fromDate: "2027-02-01", thruDate: "2027-02-26", hoursPerWeek: 20, comments: "The new screens" }))
        made.placeholder = out.workEffortAllocationId
        const joeApprove = as("joe.developer", () => errorOf(`${RS}.approve#Allocation`, { workEffortAllocationId: made.placeholder }))
        const joeChange = as("joe.developer", () => call(`${RS}.update#Allocation`, { workEffortAllocationId: made.placeholder, hoursPerWeek: 16 }))
        const bobSees = as("bob.developer", () => errorOf(`${RS}.get#AllocationAccess`, { workEffortAllocationId: made.placeholder, need: "view" }))
        const bobList = as("bob.developer", () => call(`${RS}.find#Allocations`, { list: "all", rootWorkEffortId: "RSW" }))
        return { out, joeApprove, joeChange, bobSees, bobList, row: one("mantle.work.effort.WorkEffortAllocation", { workEffortAllocationId: made.placeholder }),
            notices: messagesOf("AllocationRequest", made.placeholder) }
    },
    then({ out, joeApprove, joeChange, bobSees, bobList, row, notices }) {
        out.statusId == "WealRequested"
        row.statusId == "WealRequested"
        row.partyId == null
        row.rootWorkEffortId == "RSW"
        new Date(Number(String(row.fromDate))).toISOString().startsWith("2027-02-01")
        Number(String(row.hoursPerWeek)) == 16
        row.requestedByUserId == "ORG_ZIZI_JD"
        joeApprove.includes("Only those who approve")
        joeChange.message == "Allocation changed"
        bobSees.includes("not available")
        bobList.rowList.length == 0
        notices.length == 1
        usersOf(notices[0]).includes("EX_JOHN_DOE")
        !usersOf(notices[0]).includes("ORG_ZIZI_JD")
        notices[0].titleText.includes("Resource walk")
    },
})

feature("the staffing candidates: Pat, who has the skill and the hours free in every week, first; john staffs the placeholder with Pat, which allocates it", {
    when() {
        const found = call(`${RS}.find#StaffingCandidates`, { workEffortAllocationId: made.placeholder, limit: 50 })
        const byFields = call(`${RS}.find#StaffingCandidates`, { fromDate: "2027-02-01", thruDate: "2027-02-12", hoursPerWeek: 30, skillTypeEnumId: "RswSkDesign" })
        const staffed = call(`${RS}.staff#Allocation`, { workEffortAllocationId: made.placeholder, partyId: "RSW_PAT" })
        return { found, byFields, staffed, row: one("mantle.work.effort.WorkEffortAllocation", { workEffortAllocationId: made.placeholder }),
            request: messagesOf("AllocationRequest", made.placeholder), decision: messagesOf("AllocationDecision", made.placeholder) }
    },
    then({ found, byFields, staffed, row, request, decision }) {
        found.candidateList[0].partyId == "RSW_PAT"
        found.candidateList[0].hasSkill == true
        found.candidateList[0].skillRating == 4
        found.candidateList[0].fits == true
        found.candidateList[0].needHours == 64
        found.candidateList[0].freeHours == 96
        found.candidateList[0].currentProjects.includes("Resource walk")
        found.candidateList.some((one) => one.partyId == "RSW_SAM")
        // 30 hours a week is more than Pat's 24: Pat has the skill, but is short in both weeks
        const pat = byFields.candidateList.find((one) => one.partyId == "RSW_PAT")
        pat.fits == false
        pat.shortWeeks == 2
        staffed.statusId == "WealAllocated"
        row.partyId == "RSW_PAT"
        row.statusId == "WealAllocated"
        row.reviewedByUserId == "EX_JOHN_DOE"
        all("moqui.security.user.NotificationMessageUser", { notificationMessageId: request[0].notificationMessageId }).every((user) => user.viewedDate != null)
        decision.length == 1
        usersOf(decision[0]).includes("ORG_ZIZI_JD")
    },
})

feature("Sam allocated at 50 % and 16 hours: the team plan shows the week of leave and the holiday overbooked, the assigned work spread, and no placeholder left", {
    when() {
        made.half = call(`${RS}.create#Allocation`, { workEffortId: "RSW", partyId: "RSW_SAM", roleTypeId: "Programmer", fromDate: "2027-02-01", thruDate: "2027-02-12",
            allocationPercent: 50 }).workEffortAllocationId
        made.more = call(`${RS}.create#Allocation`, { workEffortId: "RSW", partyId: "RSW_SAM", roleTypeId: "Programmer", fromDate: "2027-02-01", thruDate: "2027-02-12",
            hoursPerWeek: 16 }).workEffortAllocationId
        // 16 hours of work due Friday the 12th: spread over Sam's working days from today, the 27th
        const task = call("mantle.work.TaskServices.create#Task", { rootWorkEffortId: "RSW", workEffortName: "The planner grid", estimatedWorkTime: 16, remainingWorkTime: 16,
            assignToPartyId: "RSW_SAM", assignRoleTypeId: "Assignee" }).workEffortId
        call("update#mantle.work.effort.WorkEffort", { workEffortId: task, estimatedCompletionDate: at("2027-02-12", 17) })
        const plan = call(`${RS}.get#TeamPlan`, { fromDate: "2027-02-03", weeks: 2, partyIdList: ["RSW_PAT", "RSW_SAM"] }).plan
        const project = call(`${RS}.get#TeamPlan`, { fromDate: "2027-02-01", weeks: 2, rootWorkEffortId: "RSW", skillTypeEnumId: "RswSkDesign" }).plan
        return { plan, project }
    },
    then({ plan, project }) {
        plan.fromDate == "2027-02-01"
        plan.weekList.length == 2
        const pat = plan.personList.find((person) => person.partyId == "RSW_PAT")
        const sam = plan.personList.find((person) => person.partyId == "RSW_SAM")
        weekOf(pat, "2027-02-01").allocated == 16
        weekOf(pat, "2027-02-01").over == false
        pat.skillList[0].skillTypeEnumId == "RswSkDesign"
        pat.allocationList.length == 1
        pat.allocationList[0].weekHours["2027-02-01"] == 16
        // 50 % of 40 working hours (leave and holidays do not lower an allocation) and 16: 36 of a capacity of 24
        weekOf(sam, "2027-02-01").allocated == 36
        weekOf(sam, "2027-02-01").capacity == 24
        weekOf(sam, "2027-02-01").over == true
        weekOf(sam, "2027-02-01").load == 1.5
        weekOf(sam, "2027-02-08").allocated == 36
        weekOf(sam, "2027-02-08").over == false
        // 16 hours over 11 working days (3 in January, 3 of the first week, 5 of the second)
        weekOf(sam, "2027-02-01").assigned == 4.36
        weekOf(sam, "2027-02-08").assigned == 7.27
        sam.roleTypeId == "Programmer"
        plan.placeholderList.length == 0
        plan.isApprover == true
        // the find: the project and the skill leave Pat only
        project.personList.map((person) => person.partyId).join(",") == "RSW_PAT"
        project.options.skillOptions.some((option) => option.value == "RswSkDesign")
    },
})

feature("joe requests Sam for 8 more hours; john rejects it; joe may not cancel an allocated one, john may; the lists count them", {
    when() {
        made.extra = as("joe.developer", () => call(`${RS}.create#Allocation`, { workEffortId: "RSW", partyId: "RSW_SAM", fromDate: "2027-02-08", thruDate: "2027-02-12",
            hoursPerWeek: 8 })).workEffortAllocationId
        const counts = call(`${RS}.find#Allocations`, { list: "requested", rootWorkEffortId: "RSW" })
        const homeJohn = call(`${PROJECT}.get#ProjectHomeCounts`, { managers: true }).counts
        const homeJoe = as("joe.developer", () => call(`${PROJECT}.get#ProjectHomeCounts`, { managers: true }).counts)
        const rejected = call(`${RS}.reject#Allocation`, { workEffortAllocationId: made.extra, reason: "Sam is over in the week of the 1st" })
        const joeCancel = as("joe.developer", () => errorOf(`${RS}.cancel#Allocation`, { workEffortAllocationId: made.more }))
        const cancelled = call(`${RS}.cancel#Allocation`, { workEffortAllocationId: made.more })
        const mine = as("joe.developer", () => call(`${RS}.find#Allocations`, { list: "mine", rootWorkEffortId: "RSW" }))
        const after = call(`${RS}.find#Allocations`, { list: "all", rootWorkEffortId: "RSW" })
        return { counts, homeJohn, homeJoe, rejected, joeCancel, cancelled, mine, after,
            rejectedRow: one("mantle.work.effort.WorkEffortAllocation", { workEffortAllocationId: made.extra }), decision: messagesOf("AllocationDecision", made.extra) }
    },
    then({ counts, homeJohn, homeJoe, rejected, joeCancel, cancelled, mine, after, rejectedRow, decision }) {
        counts.rowList.length == 1
        counts.rowList[0].personName == "Sam Planner"
        counts.rowList[0].canApprove == true
        counts.counts.requested == 1
        counts.counts.allocated == 3
        counts.counts.unstaffed == 0
        homeJohn.allocationRequests >= 1
        homeJoe.allocationRequests == null
        rejected.message == "Allocation rejected"
        joeCancel.includes("may not change")
        cancelled.message == "Allocation cancelled"
        rejectedRow.statusId == "WealRejected"
        rejectedRow.reviewComments == "Sam is over in the week of the 1st"
        decision.length == 1
        usersOf(decision[0]).includes("ORG_ZIZI_JD")
        // joe requested the placeholder and the extra hours
        mine.counts.mine == 2
        after.counts.all == 4
        after.counts.allocated == 2
        after.counts.requested == 0
        after.rowList.find((row) => row.workEffortAllocationId == made.half).hoursText == "50 %"
    },
})
