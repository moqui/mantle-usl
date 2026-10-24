// Calendars, events, invitations, free/busy, resource booking and reminders (mantle.work.CalendarServices and
// mantle.work.EventServices): calendar collections with shares and publish links, get#FullCalendarData over calendars,
// parties, rooms and equipment, RSVP, invitations to new and changed attendees, get#FreeBusy, book#Resource, the reminder
// job, recurrence, feeds, export and import and the iMIP REPLY (the framework's ICalendar tool; no feed is fetched over
// the network) and the WorkEffortPartyAsset view: the Mantle side of IronStone M7. New spec, no Groovy original.
function errorOf(name, params) {
    try { call(name, params) } catch (e) { ec.message.clearErrors(); return String(e.message) }
    return null
}
const hour = 3600000
const day = 24 * hour
// Monday 10 May 2027 in Chicago (CDT, UTC-5), the time zone of the spec's users; far from the real clock, so the reminder
// job the scheduler runs never sees these events
const dayStart = Date.UTC(2027, 4, 10, 5, 0, 0)
const at = (hours) => new Date(dayStart + hours * hour)
const setTime = (hours) => ec.user.setEffectiveTime(dayStart + hours * hour)
const CAL = "mantle.work.CalendarServices"
const EV = "mantle.work.EventServices"
const WEP = "mantle.work.effort.WorkEffortParty"
const party = {}
const user = {}
const cal = {}
const we = {}
let publishToken
// the scheduler's fetch job would GET the spec's feed URL (https://calendar.example.com/...): it is paused while the
// spec runs, so no spec step reaches the network
const FETCH_JOB = "fetch_CalendarSubscriptions"
let fetchJobPaused = null

spec({
    stepwise: true,
    setupSpec() {
        login("john.doe")
        setTime(8)
        ec.artifactExecution.disableAuthz()
        try {
            const job = ec.entity.find("moqui.service.job.ServiceJob").condition("jobName", FETCH_JOB).one()
            if (job != null) {
                fetchJobPaused = job.paused ?? "N"
                call("update#moqui.service.job.ServiceJob", { jobName: FETCH_JOB, paused: "Y" })
            }
        } finally { ec.artifactExecution.enableAuthz() }
    },
    cleanupSpec() {
        if (fetchJobPaused == null) return
        ec.artifactExecution.disableAuthz()
        try { call("update#moqui.service.job.ServiceJob", { jobName: FETCH_JOB, paused: fetchJobPaused }) }
        finally { ec.artifactExecution.enableAuthz() }
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() {
        ec.artifactExecution.enableAuthz()
        login("john.doe")
    },
})

// run as one of the spec's users (authz stays disabled, so only the services' own conditions apply)
function as(first, run) {
    login(`cs.${first.toLowerCase()}`, "moqui1!!")
    try { return run() } finally { login("john.doe") }
}
const event = (name, fields) => call(`${EV}.create#Event`, Object.assign({ workEffortName: name }, fields)).workEffortId
const invite = (workEffortId, partyId, statusId) => call("mantle.work.WorkEffortServices.add#WorkEffortParty", { workEffortId, partyId,
        roleTypeId: "Assignee", statusId: statusId || "WeptOffered" })
const rowOf = (workEffortId, partyId) => ec.entity.find(WEP).condition("workEffortId", workEffortId).condition("partyId", partyId).one()
const notices = (userId, topic) => Array.from(ec.entity.find("moqui.security.user.NotificationMessageUser").condition("userId", userId).list())
        .map((row) => ec.entity.find("moqui.security.user.NotificationMessage").condition("notificationMessageId", row.notificationMessageId).one())
        .filter((notice) => notice.topic === topic)
const week = (params) => call(`${EV}.get#FullCalendarData`, Object.assign({ start: "2027-05-09", end: "2027-05-15" }, params)).eventList
const namesOf = (events) => events.map((item) => item.title)
const millis = (value) => value == null ? null : (/^-?\d+$/.test(String(value)) ? Number(value) : Date.parse(String(value)))
// a date field (epoch millis text of its UTC day) as yyyy-MM-dd
const dayText = (value) => value == null ? null : new Date(millis(value)).toISOString().substring(0, 10)

feature("four users of an organization, an outside contact, two meeting rooms (one with an approver) and a projector", {
    when() {
        for (const first of ["Ada", "Ben", "Cy", "Dee"]) {
            const username = `cs.${first.toLowerCase()}`
            party[first] = call("mantle.party.PartyServices.create#Person", { firstName: first, lastName: "Calendarspec" }).partyId
            user[first] = call("mantle.party.PartyServices.create#PartyUserAccount", { partyId: party[first], emailAddress: `${username}@example.com`,
                    username, newPassword: "moqui1!!", newPasswordVerify: "moqui1!!", timeZone: "America/Chicago" }).userId
            call("create#mantle.party.PartyRelationship", { relationshipTypeEnumId: "PrtEmployee", fromPartyId: party[first], fromRoleTypeId: "Employee",
                    toPartyId: "ORG_ZIZI_RETAIL", toRoleTypeId: "OrgInternal", fromDate: dayStart - 30 * day })
        }
        party.Xena = call("mantle.party.PartyServices.create#Person", { firstName: "Xena", lastName: "Outside" }).partyId
        call("mantle.party.ContactServices.create#EmailAddress", { partyId: party.Xena, emailAddress: "xena.outside@example.com",
                contactMechPurposeId: "EmailPrimary" })
        call("create#mantle.facility.Facility", { facilityId: "CS_ROOM_A", facilityTypeEnumId: "FcTpRoom", facilityName: "Calendar Room A",
                ownerPartyId: "ORG_ZIZI_RETAIL" })
        call("create#mantle.facility.Facility", { facilityId: "CS_ROOM_B", facilityTypeEnumId: "FcTpRoom", facilityName: "Calendar Room B",
                ownerPartyId: "ORG_ZIZI_RETAIL" })
        call("create#mantle.facility.FacilityParty", { facilityId: "CS_ROOM_B", partyId: party.Dee, roleTypeId: "BookingApprover",
                fromDate: dayStart - day })
        call("create#mantle.product.asset.Asset", { assetId: "CS_PROJECTOR", assetTypeEnumId: "AstTpEquipment", assetName: "Calendar Projector",
                ownerPartyId: "ORG_ZIZI_RETAIL" })
        return {}
    },
    then() {
        Object.values(user).every((userId) => userId != null)
        party.Xena != null
    },
})

feature("a user's default calendar is made on first use; another can take the default, and the default is not deleted", {
    when() {
        setTime(8.01)
        return as("Ada", () => {
            const first = call(`${CAL}.get#UserCalendars`, {})
            const again = call(`${CAL}.ensure#UserDefaultCalendar`, {})
            cal.adaDefault = again.calendarId
            cal.projects = call(`${CAL}.create#Calendar`, { calendarName: "Ada Projects", color: "#43a047" }).calendarId
            const projects = ec.entity.find("mantle.work.calendar.Calendar").condition("calendarId", cal.projects).one()
            call(`${CAL}.update#Calendar`, { calendarId: cal.projects, isDefault: "Y" })
            const defaultsAfter = Array.from(ec.entity.find("mantle.work.calendar.Calendar").condition("ownerPartyId", party.Ada)
                    .condition("isDefault", "Y").list()).map((row) => row.calendarId)
            call(`${CAL}.update#Calendar`, { calendarId: cal.adaDefault, isDefault: "Y" })
            const deleteDefault = errorOf(`${CAL}.delete#Calendar`, { calendarId: cal.adaDefault })
            // a shared calendar of the organization: its creator gets a manage share
            const team = call(`${CAL}.create#Calendar`, { calendarName: "Zizi All Hands", calendarKindEnumId: "CalkShared", ownerPartyId: "ORG_ZIZI_RETAIL" })
            cal.team = team.calendarId
            const after = call(`${CAL}.get#UserCalendars`, {})
            return { first, again, projects, defaultsAfter, deleteDefault, team, after }
        })
    },
    then({ first, again, projects, defaultsAfter, deleteDefault, team, after }) {
        first.calendarList.length == 1
        first.calendarList[0].calendarName == "Ada Calendarspec"
        first.calendarList[0].isDefault == true
        first.calendarList[0].group == "mine"
        first.calendarList[0].permissionEnumId == "CalpManage"
        again.created == false
        again.calendarId == first.defaultCalendarId
        projects.isDefault == "N"
        projects.calendarKindEnumId == "CalkPersonal"
        defaultsAfter == [cal.projects]
        deleteDefault.includes("default calendar cannot be deleted")
        team.calendarShareId != null
        after.calendarList.map((entry) => entry.calendarName) == ["Ada Calendarspec", "Ada Projects", "Zizi All Hands"]
        after.calendarList.find((entry) => entry.calendarId === cal.team).group == "shared"
        after.calendarList.find((entry) => entry.calendarId === cal.team).permissionEnumId == "CalpManage"
    },
})

feature("shares give view, free/busy or edit to a user, a group or an organization's people; only a manager shares", {
    when() {
        setTime(8.02)
        const shared = as("Ada", () => {
            call(`${CAL}.share#Calendar`, { calendarId: cal.projects, userId: user.Ben, permissionEnumId: "CalpView" })
            call(`${CAL}.share#Calendar`, { calendarId: cal.projects, userId: user.Cy, permissionEnumId: "CalpFreeBusy" })
            // everyone of the organization may view the all-hands calendar
            call(`${CAL}.share#Calendar`, { calendarId: cal.team, partyId: "ORG_ZIZI_RETAIL", permissionEnumId: "CalpView" })
            const lowerLastManager = errorOf(`${CAL}.share#Calendar`, { calendarId: cal.team, userId: user.Ada, permissionEnumId: "CalpView" })
            const publish = call(`${CAL}.share#Calendar`, { calendarId: cal.projects, publish: true, permissionEnumId: "CalpView", password: "open sesame" })
            publishToken = publish.publishToken
            return { lowerLastManager, publish, mine: call(`${CAL}.get#UserCalendars`, {}).calendarList }
        })
        const ben = as("Ben", () => ({
            calendars: call(`${CAL}.get#UserCalendars`, {}).calendarList,
            share: errorOf(`${CAL}.share#Calendar`, { calendarId: cal.projects, userId: user.Dee }),
        }))
        const cy = as("Cy", () => call(`${CAL}.check#CalendarAccess`, { calendarId: cal.projects }))
        const dee = as("Dee", () => ({
            team: call(`${CAL}.check#CalendarAccess`, { calendarId: cal.team }).userPermissionEnumId,
        }))
        // unsharing ends the share
        setTime(8.03)
        as("Ada", () => call(`${CAL}.share#Calendar`, { calendarId: cal.team, userId: user.Dee, permissionEnumId: "CalpEdit" }))
        const deeEdit = as("Dee", () => call(`${CAL}.check#CalendarAccess`, { calendarId: cal.team }).userPermissionEnumId)
        setTime(8.04)
        const unshared = as("Ada", () => call(`${CAL}.unshare#Calendar`, { calendarId: cal.team, userId: user.Dee }).unsharedCount)
        const deeAfter = as("Dee", () => call(`${CAL}.check#CalendarAccess`, { calendarId: cal.team }).userPermissionEnumId)
        return { shared, ben, cy, dee, deeEdit, unshared, deeAfter }
    },
    then({ shared, ben, cy, dee, deeEdit, unshared, deeAfter }) {
        shared.lowerLastManager.includes("keeps at least one manage share")
        shared.publish.publishToken.length == 40
        shared.mine.find((entry) => entry.calendarId === cal.projects).shareCount == 2
        shared.mine.find((entry) => entry.calendarId === cal.projects).hasPublishLink == true
        ben.calendars.filter((entry) => entry.group === "shared").map((entry) => [entry.calendarName, entry.permissionEnumId]) ==
            [["Ada Projects", "CalpView"], ["Zizi All Hands", "CalpView"]]
        ben.calendars.find((entry) => entry.calendarId === cal.projects).ownerName == "Ada Calendarspec"
        ben.share.includes("You need permission to manage")
        cy.userPermissionEnumId == "CalpFreeBusy"
        cy.isOwner == false
        dee.team == "CalpView"
        deeEdit == "CalpEdit"
        unshared == 1
        // the organization's share still gives view
        deeAfter == "CalpView"
    },
})

feature("events in calendars, with invitations, a meeting room, a declined lunch, a daily standup and an all-day holiday", {
    when() {
        setTime(8.1)
        as("Ada", () => {
            we.review = event("Design review", { estimatedStartDate: at(10), estimatedCompletionDate: at(11), assignToPartyId: party.Ada,
                    calendarId: cal.projects, purposeEnumId: "WepMeeting" })
            we.focus = event("Focus time", { estimatedStartDate: at(13), estimatedCompletionDate: at(14), assignToPartyId: party.Ada,
                    calendarId: cal.projects })
            we.standup = event("Daily standup", { estimatedStartDate: at(9), estimatedCompletionDate: at(9.25), assignToPartyId: party.Ada,
                    recurStartCron: "0 0 9 * * ?", recurLimit: 3 })
            we.holiday = event("Company holiday", { allDayStart: "2027-05-14", assignToPartyId: party.Ada, calendarId: cal.team })
            we.roomSync = event("Room sync", { estimatedStartDate: at(24 + 14), estimatedCompletionDate: at(24 + 15), assignToPartyId: party.Ada })
            we.lunch = event("Team lunch", { estimatedStartDate: at(12), estimatedCompletionDate: at(13), assignToPartyId: party.Ada })
            return null
        })
        invite(we.review, party.Ben)
        invite(we.review, party.Cy)
        invite(we.lunch, party.Ben, "WeptDeclined")
        return { calendarRows: ec.entity.find("mantle.work.calendar.CalendarWorkEffort").condition("calendarId", cal.projects).count() }
    },
    then({ calendarRows }) {
        Object.values(we).every((workEffortId) => workEffortId != null)
        calendarRows == 2
        rowOf(we.review, party.Ben).statusId == "WeptOffered"
    },
})

feature("book#Resource: without a policy assigned at once, a conflict refused, with an approver requested, equipment and cancel", {
    when() {
        setTime(8.2)
        return as("Ada", () => {
            const roomA = call(`${EV}.book#Resource`, { workEffortId: we.roomSync, facilityId: "CS_ROOM_A" })
            const again = call(`${EV}.book#Resource`, { workEffortId: we.roomSync, facilityId: "CS_ROOM_A" })
            we.overlap = event("Overlapping sync", { estimatedStartDate: at(24 + 14.5), estimatedCompletionDate: at(24 + 15.5), assignToPartyId: party.Ada })
            const refused = errorOf(`${EV}.book#Resource`, { workEffortId: we.overlap, facilityId: "CS_ROOM_A" })
            const refusedRows = ec.entity.find("mantle.work.effort.WorkEffortFacility").condition("workEffortId", we.overlap).count()
            const allowed = call(`${EV}.book#Resource`, { workEffortId: we.overlap, facilityId: "CS_ROOM_A", allowConflicts: true })
            const cancelled = call(`${EV}.cancel#ResourceBooking`, { workEffortId: we.overlap, facilityId: "CS_ROOM_A" }).cancelledCount
            const roomB = call(`${EV}.book#Resource`, { workEffortId: we.review, facilityId: "CS_ROOM_B" })
            const projector = call(`${EV}.book#Resource`, { workEffortId: we.review, assetId: "CS_PROJECTOR" })
            return { roomA, again, refused, refusedRows, allowed, cancelled, roomB, projector }
        })
    },
    then({ roomA, again, refused, refusedRows, allowed, cancelled, roomB, projector }) {
        roomA.statusId == "WefAssigned"
        roomA.requiresApproval == false
        again.statusId == "WefAssigned"
        refused.includes("Calendar Room A is booked then: Room sync")
        refusedRows == 0
        allowed.statusId == "WefAssigned"
        allowed.conflictList.map((conflict) => conflict.workEffortId) == [we.roomSync]
        cancelled == 1
        roomB.statusId == "WefRequested"
        roomB.requiresApproval == true
        roomB.approverPartyIdList == [party.Dee]
        projector.statusId == "WeaaAssigned"
        ec.entity.find("mantle.work.effort.WorkEffortFacility").condition("workEffortId", we.overlap).count() == 0
    },
})

feature("only the organizer or an editor of its calendar books for an event", {
    when() {
        return { ben: as("Ben", () => errorOf(`${EV}.book#Resource`, { workEffortId: we.focus, facilityId: "CS_ROOM_A" })) }
    },
    then({ ben }) {
        // Ben may view Ada Projects, so he sees the event but may not change it
        ben.includes("Only the organizer of Focus time")
    },
})

feature("get#FullCalendarData: calendars with their colors, my events, the standup's recurLimit, all-day days, free/busy calendars", {
    when() {
        setTime(8.3)
        const ada = as("Ada", () => week({ calendarIdList: [cal.projects, cal.team] }))
        const ben = as("Ben", () => week({ calendarIdList: [cal.projects] }))
        const cy = as("Cy", () => week({ calendarIdList: [cal.projects] }))
        const dee = as("Dee", () => call(`${EV}.get#FullCalendarData`, { start: "2027-05-09", end: "2027-05-15", calendarIdList: [cal.projects] }))
        return { ada, ben, cy, dee }
    },
    then({ ada, ben, cy, dee }) {
        // Ada: her two calendars plus every event she is on (the standup is in no calendar), the standup three times by recurLimit
        namesOf(ada).filter((name) => name.startsWith("Daily standup")).length == 3
        ada.filter((item) => item.workEffortId === we.standup).map((item) => item.start) ==
            ["2027-05-10T09:00:00", "2027-05-11T09:00:00", "2027-05-12T09:00:00"]
        ada.find((item) => item.workEffortId === we.standup).recurring == true
        ada.find((item) => item.workEffortId === we.review).color == "#43a047"
        ada.find((item) => item.workEffortId === we.review).calendarId == cal.projects
        ada.find((item) => item.workEffortId === we.review).start == "2027-05-10T10:00:00"
        ada.find((item) => item.workEffortId === we.review).end == "2027-05-10T11:00:00"
        ada.find((item) => item.workEffortId === we.review).title == `Design review [${we.review}]`
        ada.find((item) => item.workEffortId === we.holiday).allDay == true
        ada.find((item) => item.workEffortId === we.holiday).start == "2027-05-14"
        ada.find((item) => item.workEffortId === we.holiday).end == "2027-05-15"
        ada.find((item) => item.workEffortId === we.holiday).calendarId == cal.team
        ada.find((item) => item.workEffortId === we.roomSync).calendarId == null
        ada.find((item) => item.workEffortId === we.lunch) != null
        // Ben: the shared calendar's events and the review he is invited to; the lunch he declined is left out
        ben.map((item) => item.workEffortId).includes(we.focus)
        ben.find((item) => item.workEffortId === we.review).partyStatusId == "WeptOffered"
        !ben.map((item) => item.workEffortId).includes(we.lunch)
        !ben.map((item) => item.workEffortId).includes(we.standup)
        // Cy: free/busy on Ada Projects, so the focus time is Busy without its details; the review Cy is invited to shows
        cy.find((item) => item.workEffortId === we.focus).title == "Busy"
        cy.find((item) => item.workEffortId === we.focus).freeBusyOnly == true
        cy.find((item) => item.workEffortId === we.review).freeBusyOnly == false
        // Dee: not shared, so the calendar is skipped
        dee.skippedCalendarIdList == [cal.projects]
        !dee.eventList.map((item) => item.workEffortId).includes(we.focus)
    },
})

feature("get#FullCalendarData: a room through WorkEffortFacility, equipment, and declined invitations hidden or shown", {
    when() {
        setTime(8.4)
        const roomA = week({ facilityId: "CS_ROOM_A" })
        const roomB = week({ facilityIdList: ["CS_ROOM_B"] })
        const projector = week({ assetId: "CS_PROJECTOR" })
        const benHidden = week({ partyId: party.Ben })
        const benShown = week({ partyId: party.Ben, showDeclined: true })
        return { roomA, roomB, projector, benHidden, benShown }
    },
    then({ roomA, roomB, projector, benHidden, benShown }) {
        // the booking of Room A is a WorkEffortFacility row (Room sync has no WorkEffort.facilityId); the cancelled overlap is gone
        roomA.map((item) => item.workEffortId) == [we.roomSync]
        roomA[0].bookingStatusId == "WefAssigned"
        roomB.map((item) => item.workEffortId) == [we.review]
        roomB[0].bookingStatusId == "WefRequested"
        projector.map((item) => item.workEffortId) == [we.review]
        projector[0].bookingStatusId == "WeaaAssigned"
        !benHidden.map((item) => item.workEffortId).includes(we.lunch)
        benHidden.map((item) => item.workEffortId).includes(we.review)
        benShown.find((item) => item.workEffortId === we.lunch).partyStatusId == "WeptDeclined"
    },
})

feature("RSVP: accept, tentative and decline on my own row, each answer notifying the organizer", {
    when() {
        const statuses = []
        const answers = ["accept", "tentative", "decline", "accept"]
        answers.forEach((response, index) => {
            setTime(8.5 + index * 0.01)
            const out = as("Ben", () => call(`${EV}.respond#EventInvitation`, { workEffortId: we.review, response,
                    message: response === "decline" ? "Out that morning" : null }))
            statuses.push([out.statusId, rowOf(we.review, party.Ben).statusId, out.notifiedUserIds])
        })
        setTime(8.55)
        as("Cy", () => call(`${EV}.respond#EventInvitation`, { workEffortId: we.review, response: "tentative" }))
        return { statuses, adaNotices: notices(user.Ada, "EventInvitationResponse") }
    },
    then({ statuses, adaNotices }) {
        statuses.map((entry) => entry[0]) == ["WeptAssigned", "WeptTentative", "WeptDeclined", "WeptAssigned"]
        statuses.map((entry) => entry[1]) == ["WeptAssigned", "WeptTentative", "WeptDeclined", "WeptAssigned"]
        statuses.every((entry) => entry[2].length == 1 && entry[2][0] === user.Ada)
        adaNotices.length == 5
        adaNotices.some((notice) => notice.titleText === "Ben Calendarspec declined Design review: Out that morning")
        adaNotices.some((notice) => notice.titleText === "Cy Calendarspec tentatively accepted Design review")
        rowOf(we.review, party.Cy).statusId == "WeptTentative"
    },
})

feature("send#EventInvitations goes to new or changed attendees only: users by notification, an outside contact by email", {
    when() {
        setTime(8.6)
        const first = as("Ada", () => call(`${EV}.send#EventInvitations`, { workEffortId: we.review }))
        const firstNotices = { ben: notices(user.Ben, "EventInvitation"), cy: notices(user.Cy, "EventInvitation") }
        setTime(8.61)
        const nothingNew = as("Ada", () => call(`${EV}.send#EventInvitations`, { workEffortId: we.review }))
        // a new attendee from outside
        setTime(8.62)
        invite(we.review, party.Xena)
        const second = as("Ada", () => call(`${EV}.send#EventInvitations`, { workEffortId: we.review }))
        const email = ec.entity.find("moqui.basic.email.EmailMessage").condition("toAddresses", "xena.outside@example.com").one()
        // the event moves: everyone gets the update
        setTime(8.63)
        call("update#mantle.work.effort.WorkEffort", { workEffortId: we.review, estimatedStartDate: at(10.5), estimatedCompletionDate: at(11.5) })
        const third = as("Ada", () => call(`${EV}.send#EventInvitations`, { workEffortId: we.review }))
        const benUpdate = notices(user.Ben, "EventInvitation")
        setTime(8.64)
        const fourth = as("Ada", () => call(`${EV}.send#EventInvitations`, { workEffortId: we.review }))
        return { first, firstNotices, nothingNew, second, email, third, benUpdate, fourth }
    },
    then({ first, firstNotices, nothingNew, second, email, third, benUpdate, fourth }) {
        first.sentPartyIdList.sort() == [party.Ben, party.Cy].sort()
        first.notifiedUserIds.sort() == [user.Ben, user.Cy].sort()
        first.emailedAddressList.length == 0
        firstNotices.ben.length == 1
        firstNotices.ben[0].titleText.startsWith("Ada Calendarspec invited you to Design review, Mon, May 10, 2027 10:00 AM")
        firstNotices.cy.length == 1
        nothingNew.sentPartyIdList.length == 0
        second.sentPartyIdList == [party.Xena]
        second.emailedAddressList == ["xena.outside@example.com"]
        second.notifiedUserIds.length == 0
        email != null
        email.subject.startsWith("Invitation: Design review")
        email.fromAddress == "cs.ada@example.com"
        email.body.includes("Ada Calendarspec invited you to Design review")
        third.sentPartyIdList.sort() == [party.Ben, party.Cy, party.Xena].sort()
        benUpdate.length == 2
        benUpdate.some((notice) => notice.titleText.startsWith("Ada Calendarspec updated Design review, Mon, May 10, 2027 10:30 AM"))
        fourth.sentPartyIdList.length == 0
        rowOf(we.review, party.Xena).invitationSentDate != null
        rowOf(we.review, party.Xena).invitationDigest.length == 8
    },
})

feature("get#FreeBusy: a booked room is busy, a declined meeting is not, a tentative answer is tentative; suggested slots", {
    when() {
        setTime(8.7)
        const out = as("Ada", () => call(`${EV}.get#FreeBusy`, { partyIdList: [party.Ben, party.Cy], facilityIdList: ["CS_ROOM_A"],
                fromDate: at(0), thruDate: at(48), workingHoursOnly: true, durationMinutes: 60 }))
        return { out, ben: out.freeBusyList.find((entry) => entry.partyId === party.Ben), cy: out.freeBusyList.find((entry) => entry.partyId === party.Cy),
            room: out.freeBusyList.find((entry) => entry.facilityId === "CS_ROOM_A") }
    },
    then({ out, ben, cy, room }) {
        // Ben accepted the review (now 10:30 to 11:30) and declined the lunch (12:00): only the review is busy
        ben.busyList.map((busy) => [millis(busy.fromDate), millis(busy.thruDate), busy.status]) == [[at(10.5).getTime(), at(11.5).getTime(), "busy"]]
        cy.busyList.map((busy) => busy.status) == ["tentative"]
        room.busyList.map((busy) => [millis(busy.fromDate), millis(busy.thruDate)]) == [[at(24 + 14).getTime(), at(24 + 15).getTime()]]
        // working hours by default, 09:00 to 17:00 on Monday and Tuesday
        ben.workingHourList.map((hours) => [millis(hours.fromDate), millis(hours.thruDate)]) ==
            [[at(9).getTime(), at(17).getTime()], [at(24 + 9).getTime(), at(24 + 17).getTime()]]
        // the first free hour for both and the room: 09:00, then 09:30; the review blocks 10:00 to 11:30
        millis(out.suggestedSlotList[0].fromDate) == at(9).getTime()
        millis(out.suggestedSlotList[1].fromDate) == at(9.5).getTime()
        millis(out.suggestedSlotList[2].fromDate) == at(11.5).getTime()
    },
})

feature("reminders: stored per party, sent once each, a snoozed one held back and sent again after the snooze", {
    when() {
        setTime(9)
        as("Ada", () => {
            we.reminded = event("Reminder check", { estimatedStartDate: at(12), estimatedCompletionDate: at(13), assignToPartyId: party.Ada })
            return null
        })
        invite(we.reminded, party.Ben, "WeptAssigned")
        const stored = as("Ada", () => call(`${EV}.store#WorkEffortReminders`, { workEffortId: we.reminded,
                reminderList: [{ offsetMinutes: 15 }, { offsetMinutes: 60, methodEnumId: "WermEmail" }] }))
        as("Ben", () => call(`${EV}.store#WorkEffortReminders`, { workEffortId: we.reminded, reminderList: [{ offsetMinutes: 10 }] }))
        const run = () => call(`${EV}.send#DueReminders`, {}).sentCount
        setTime(11 + 40 / 60)
        const at1140 = run()
        const at1140again = run()
        const adaEmail = Array.from(ec.entity.find("moqui.basic.email.EmailMessage").condition("toAddresses", "cs.ada@example.com").list())
                .filter((message) => String(message.subject).startsWith("Reminder: Reminder check"))
        setTime(11 + 49 / 60)
        const snoozed = as("Ben", () => call(`${EV}.snooze#Reminder`, { workEffortId: we.reminded, snoozeMinutes: 30 }))
        setTime(11 + 50 / 60)
        const at1150 = run()
        const benAt1150 = notices(user.Ben, "WorkEffortReminder").length
        const adaNotices = notices(user.Ada, "WorkEffortReminder")
        setTime(12 + 20 / 60)
        const at1220 = run()
        const benNotices = notices(user.Ben, "WorkEffortReminder")
        setTime(12 + 25 / 60)
        const at1225 = run()
        // the 15 minute reminder stays when the list is stored again with it; the email one goes
        setTime(12.5)
        const restored = as("Ada", () => call(`${EV}.store#WorkEffortReminders`, { workEffortId: we.reminded, reminderList: [{ offsetMinutes: 15 }] }))
        const adaRows = Array.from(ec.entity.find("mantle.work.effort.WorkEffortReminder").condition("workEffortId", we.reminded)
                .condition("partyId", party.Ada).list())
        return { stored, at1140, at1140again, adaEmail, snoozed, at1150, benAt1150, adaNotices, at1220, benNotices, at1225, restored, adaRows }
    },
    then({ stored, at1140, at1140again, adaEmail, snoozed, at1150, benAt1150, adaNotices, at1220, benNotices, at1225, restored, adaRows }) {
        stored.reminderSeqIdList == ["01", "02"]
        // 11:40: Ada's email an hour before
        at1140 == 1
        at1140again == 0
        adaEmail.length == 1
        adaEmail[0].subject == "Reminder: Reminder check, starts in 20 minutes"
        millis(snoozed.snoozedThruDate) == at(12 + 19 / 60).getTime()
        // 11:50: Ada's 15 minute notification; Ben's 10 minute one is snoozed
        at1150 == 1
        benAt1150 == 0
        adaNotices.length == 1
        adaNotices[0].titleText == "Reminder: Reminder check, starts in 10 minutes"
        // 12:20: the snooze ran out, Ben's comes again once
        at1220 == 1
        benNotices.length == 1
        benNotices[0].titleText == "Reminder: Reminder check, starting now"
        at1225 == 0
        restored.reminderSeqIdList == ["01"]
        restored.removedCount == 1
        adaRows.length == 1
        adaRows[0].sentDate != null
    },
})

feature("a recurring event: without the ICalendar tool the series' first instance only, and a changed instance replaces it", {
    when() {
        setTime(13)
        const series = as("Ada", () => event("Weekly one on one", { estimatedStartDate: at(15), estimatedCompletionDate: at(15.5),
                assignToPartyId: party.Ada, rrule: "FREQ=WEEKLY;COUNT=5", recurrenceTimeZone: "America/Chicago" }))
        we.weekly = series
        const toolAvailable = ec.factory.getToolFactory("ICalendar") != null
        const twoWeeks = (params) => call(`${EV}.get#FullCalendarData`, Object.assign({ start: "2027-05-09", end: "2027-05-22", partyId: party.Ada }, params))
                .eventList.filter((item) => (item.recurringEventId || item.workEffortId) === series)
        const before = twoWeeks()
        const instances = call(`${EV}.get#EventInstances`, { workEffortList: [ec.entity.find("mantle.work.effort.WorkEffort")
                .condition("workEffortId", series).one().getMap()], rangeStart: at(0), rangeEnd: at(14 * 24) })
        // this week's instance moved to 16:00
        const moved = as("Ada", () => event("Weekly one on one (moved)", { estimatedStartDate: at(16), estimatedCompletionDate: at(16.5) }))
        call("create#mantle.work.effort.WorkEffortAssoc", { workEffortId: series, toWorkEffortId: moved, workEffortAssocTypeEnumId: "WeatRecurrenceInstance",
                fromDate: at(15) })
        const after = twoWeeks()
        const recurrence = ec.entity.find("mantle.work.effort.WorkEffortRecurrence").condition("workEffortId", series).one()
        return { toolAvailable, before, instances, moved, after, recurrence }
    },
    then({ toolAvailable, before, instances, moved, after, recurrence }) {
        recurrence.rrule == "FREQ=WEEKLY;COUNT=5"
        recurrence.timeZone == "America/Chicago"
        // with the tool (later) two weeks have two instances; until then the first only
        before.length == (toolAvailable ? 2 : 1)
        before[0].start == "2027-05-10T15:00:00"
        before[0].recurring == true
        before[0].recurringEventId == we.weekly
        before[0].instanceStart == "2027-05-10T15:00:00"
        instances.toolMissing == !toolAvailable
        // the changed instance stands for the generated one
        after.filter((item) => item.start === "2027-05-10T15:00:00").length == 0
        after.find((item) => item.workEffortId === moved).start == "2027-05-10T16:00:00"
        after.find((item) => item.workEffortId === moved).recurringEventId == we.weekly
        after.find((item) => item.workEffortId === moved).instanceStart == "2027-05-10T15:00:00"
    },
})

// iCalendar text as a feed or a file has it, CRLF line ends
const icsOf = (lines) => lines.join("\r\n") + "\r\n"
// the feed as its URL would answer it after the restore below: the weekly series (now with a location) and its moved
// instance, by the same UIDs and RECURRENCE-ID
const feedIcs = icsOf(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Mantle CalendarServices spec//EN", "X-WR-CALNAME:Holidays",
    "BEGIN:VEVENT", "UID:feed-1@example.com", "DTSTAMP:20270501T120000Z", "DTSTART;TZID=America/Chicago:20270511T080000",
    "DTEND;TZID=America/Chicago:20270511T090000", "RRULE:FREQ=WEEKLY", "SUMMARY:Feed weekly", "LOCATION:Feed room", "STATUS:CONFIRMED",
    "END:VEVENT",
    "BEGIN:VEVENT", "UID:feed-1@example.com", "DTSTAMP:20270501T120000Z", "RECURRENCE-ID;TZID=America/Chicago:20270511T080000",
    "DTSTART;TZID=America/Chicago:20270511T100000", "DTEND;TZID=America/Chicago:20270511T110000", "SUMMARY:Feed weekly (later)",
    "END:VEVENT",
    "END:VCALENDAR"])

feature("feeds: a subscription is recorded, parsed events are stored, the feed's text is read by the ICalendar tool, and a fetched feed is not due", {
    when() {
        setTime(14)
        const out = as("Ada", () => {
            const subscribed = call(`${CAL}.subscribe#Calendar`, { url: "webcal://calendar.example.com/holidays.ics", color: "#757575", fetchNow: false })
            cal.feed = subscribed.calendarId
            return {
                addToFeed: errorOf(`${CAL}.add#CalendarEvent`, { calendarId: cal.feed, workEffortId: we.focus }),
                list: call(`${CAL}.get#UserCalendars`, {}).calendarList,
            }
        })
        const subscription = ec.entity.find("mantle.work.calendar.CalendarSubscription").condition("calendarId", cal.feed).one()
        // what the tool's parse gives: a weekly series, an instance of it moved, and an all-day day
        const feedEvents = [
            { uid: "feed-1@example.com", summary: "Feed weekly", start: at(24 + 8).getTime(), end: at(24 + 9).getTime(), rrule: "FREQ=WEEKLY",
                timeZone: "America/Chicago", status: "CONFIRMED" },
            { uid: "feed-1@example.com", recurrenceId: at(24 + 8).getTime(), summary: "Feed weekly (later)", start: at(24 + 10).getTime(), end: at(24 + 11).getTime() },
            { uid: "feed-2@example.com", summary: "Feed holiday", allDay: true, startDate: "2027-05-13", endDate: "2027-05-14" },
            { summary: "No UID" },
        ]
        const stored = call(`${CAL}.store#CalendarFeedEvents`, { calendarId: cal.feed, eventList: feedEvents, replaceAll: true })
        const shown = as("Ada", () => week({ calendarIdList: [cal.feed], partyId: "_NA_" }))
        setTime(14.1)
        const restored = call(`${CAL}.store#CalendarFeedEvents`, { calendarId: cal.feed, eventList: feedEvents.slice(0, 2), replaceAll: true })
        const holiday = ec.entity.find("mantle.work.effort.WorkEffort").condition("universalId", "feed-2@example.com").one()
        // the fetch's read of what the URL answered, with the text given here instead of a GET: the same two events, matched
        // by UID and RECURRENCE-ID, so updated rather than made again
        setTime(14.2)
        const fromText = call(`${CAL}.store#CalendarFeedText`, { calendarId: cal.feed, feedText: feedIcs })
        const fetchedSubscription = ec.entity.find("mantle.work.calendar.CalendarSubscription").condition("calendarId", cal.feed).one()
        const feedRows = Array.from(ec.entity.find("mantle.work.calendar.CalendarWorkEffortDetail").condition("calendarId", cal.feed).list())
        const seriesRow = feedRows.find((row) => row.workEffortName === "Feed weekly")
        const laterRow = feedRows.find((row) => row.workEffortName === "Feed weekly (later)")
        const seriesRecurrence = ec.entity.find("mantle.work.effort.WorkEffortRecurrence").condition("workEffortId", seriesRow?.workEffortId).one()
        // the fetch job: a subscription read within its refreshMinutes is not due, so its URL is not fetched
        setTime(14.3)
        const notDue = call(`${CAL}.fetch#CalendarSubscriptions`, { calendarId: cal.feed })
        const afterJob = ec.entity.find("mantle.work.calendar.CalendarSubscription").condition("calendarId", cal.feed).one()
        return { out, subscription, stored, shown, restored, holiday, fromText, fetchedSubscription, feedRows, seriesRow, laterRow,
            seriesRecurrence, notDue, afterJob }
    },
    then({ out, subscription, stored, shown, restored, holiday, fromText, fetchedSubscription, feedRows, seriesRow, laterRow,
            seriesRecurrence, notDue, afterJob }) {
        out.addToFeed.includes("come from its feed")
        out.list.find((entry) => entry.calendarId === cal.feed).group == "subscription"
        out.list.find((entry) => entry.calendarId === cal.feed).calendarName == "calendar.example.com"
        out.list.find((entry) => entry.calendarId === cal.feed).subscription.url == "webcal://calendar.example.com/holidays.ics"
        out.list.find((entry) => entry.calendarId === cal.feed).subscription.refreshMinutes == 60
        subscription.lastFetchDate == null
        stored.createdCount == 3
        stored.failedCount == 1
        // the moved instance replaces the series' first on Tuesday; the holiday is all day on Thursday
        shown.filter((item) => item.recurringEventId != null).map((item) => [item.title.replace(/ \[.*\]$/, ""), item.start]) ==
            [["Feed weekly (later)", "2027-05-11T10:00:00"]]
        shown.find((item) => item.title.startsWith("Feed holiday")).start == "2027-05-13"
        shown.find((item) => item.title.startsWith("Feed holiday")).end == "2027-05-14"
        shown.every((item) => item.color == "#757575")
        restored.updatedCount == 2
        restored.removedCount == 1
        holiday.statusId == "WeCancelled"
        fromText.createdCount == 0
        fromText.updatedCount == 2
        fromText.removedCount == 0
        fromText.failedCount == 0
        feedRows.length == 2
        seriesRow.location == "Feed room"
        seriesRow.statusId == "WeApproved"
        millis(seriesRow.estimatedStartDate) == at(24 + 8).getTime()
        millis(seriesRow.estimatedCompletionDate) == at(24 + 9).getTime()
        seriesRecurrence.rrule == "FREQ=WEEKLY"
        seriesRecurrence.timeZone == "America/Chicago"
        millis(laterRow.estimatedStartDate) == at(24 + 10).getTime()
        fetchedSubscription.lastFetchStatus == "ok"
        fetchedSubscription.lastFetchError == null
        millis(fetchedSubscription.lastFetchDate) == at(14.2).getTime()
        notDue.toolAvailable == true
        notDue.fetchedCount == 0
        notDue.failedCount == 0
        millis(afterJob.lastFetchDate) == at(14.2).getTime()
    },
})

// a weekly series with its third instance moved to the afternoon, and a two-day all-day event
const importIcs = icsOf(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Mantle CalendarServices spec//EN", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT", "UID:import-weekly@example.com", "DTSTAMP:20270501T120000Z", "DTSTART;TZID=America/Chicago:20270512T090000",
    "DTEND;TZID=America/Chicago:20270512T100000", "RRULE:FREQ=WEEKLY;COUNT=4", "SUMMARY:Imported planning", "LOCATION:Room 7",
    "DESCRIPTION:Plans for the week\\, with the team", "END:VEVENT",
    "BEGIN:VEVENT", "UID:import-weekly@example.com", "DTSTAMP:20270501T120000Z", "RECURRENCE-ID;TZID=America/Chicago:20270519T090000",
    "DTSTART;TZID=America/Chicago:20270519T140000", "DTEND;TZID=America/Chicago:20270519T150000",
    "SUMMARY:Imported planning (afternoon)", "END:VEVENT",
    "BEGIN:VEVENT", "UID:import-days@example.com", "DTSTAMP:20270501T120000Z", "DTSTART;VALUE=DATE:20270513", "DTEND;VALUE=DATE:20270515",
    "SUMMARY:Imported offsite", "TRANSP:TRANSPARENT", "END:VEVENT",
    "END:VCALENDAR"])

feature("export#Calendar writes an iCalendar file that reads back through the ICalendar tool; import#Calendar reads a series, its moved instance and an all-day event", {
    when() {
        setTime(14.5)
        return as("Ada", () => {
            const exported = call(`${CAL}.export#Calendar`, { calendarId: cal.projects })
            const reread = ec.factory.getTool("ICalendar").parse(exported.fileText)
            cal.imported = call(`${CAL}.create#Calendar`, { calendarName: "Ada Imported", color: "#8e24aa" }).calendarId
            const imported = call(`${CAL}.import#Calendar`, { calendarId: cal.imported, fileText: importIcs })
            const rows = Array.from(ec.entity.find("mantle.work.calendar.CalendarWorkEffortDetail").condition("calendarId", cal.imported).list())
            const series = rows.find((row) => row.universalId === "import-weekly@example.com" && row.workEffortName === "Imported planning")
            const moved = rows.find((row) => row.workEffortName === "Imported planning (afternoon)")
            const days = rows.find((row) => row.universalId === "import-days@example.com")
            const recurrence = ec.entity.find("mantle.work.effort.WorkEffortRecurrence").condition("workEffortId", series?.workEffortId).one()
            const link = ec.entity.find("mantle.work.effort.WorkEffortAssoc").condition("workEffortId", series?.workEffortId)
                    .condition("toWorkEffortId", moved?.workEffortId).condition("workEffortAssocTypeEnumId", "WeatRecurrenceInstance").one()
            const shown = call(`${EV}.get#FullCalendarData`, { start: "2027-05-09", end: "2027-05-22", calendarIdList: [cal.imported], partyId: "_NA_" })
                    .eventList.map((item) => [item.title.replace(/ \[.*\]$/, ""), item.start])
            // the same file again updates the events it made
            setTime(14.6)
            const again = call(`${CAL}.import#Calendar`, { calendarId: cal.imported, fileText: importIcs })
            const rowsAgain = ec.entity.find("mantle.work.calendar.CalendarWorkEffort").condition("calendarId", cal.imported).count()
            return { exported, reread, imported, rows, series, moved, days, recurrence, link, shown, again, rowsAgain }
        })
    },
    then({ exported, reread, imported, rows, series, moved, days, recurrence, link, shown, again, rowsAgain }) {
        exported.contentType == "text/calendar"
        exported.fileName == "Ada Projects.ics"
        exported.fileText.startsWith("BEGIN:VCALENDAR\r\n")
        exported.fileText.includes("METHOD:PUBLISH")
        exported.fileText.includes("BEGIN:VTIMEZONE")
        reread.method == "PUBLISH"
        reread.calendarName == "Ada Projects"
        reread.events.map((item) => item.summary).sort() == ["Design review", "Focus time"]
        reread.events.find((item) => item.summary === "Design review").start == at(10.5).getTime()
        reread.events.find((item) => item.summary === "Design review").end == at(11.5).getTime()
        reread.events.find((item) => item.summary === "Design review").timeZone == "America/Chicago"
        reread.events.find((item) => item.summary === "Design review").uid == `mantle-${we.review}`
        reread.events.find((item) => item.summary === "Design review").organizer.email == "cs.ada@example.com"
        reread.events.find((item) => item.summary === "Design review").attendees.map((person) => `${person.email}:${person.partstat}`).sort() ==
            ["cs.ben@example.com:ACCEPTED", "cs.cy@example.com:TENTATIVE", "xena.outside@example.com:NEEDS-ACTION"]
        reread.events.find((item) => item.summary === "Focus time").start == at(13).getTime()
        imported.createdCount == 3
        imported.updatedCount == 0
        imported.failedCount == 0
        rows.length == 3
        series.location == "Room 7"
        series.description == "Plans for the week, with the team"
        millis(series.estimatedStartDate) == at(48 + 9).getTime()
        millis(series.estimatedCompletionDate) == at(48 + 10).getTime()
        recurrence.rrule == "FREQ=WEEKLY;COUNT=4"
        recurrence.timeZone == "America/Chicago"
        millis(moved.estimatedStartDate) == at(7 * 24 + 48 + 14).getTime()
        moved.universalId == "import-weekly@example.com"
        millis(link.fromDate) == at(7 * 24 + 48 + 9).getTime()
        dayText(days.allDayStart) == "2027-05-13"
        dayText(days.allDayEnd) == "2027-05-14"
        days.estimatedStartDate == null
        // the series' Wednesday instances in the two weeks, the third moved to 14:00, and the two-day event
        shown.filter((entry) => entry[0].startsWith("Imported planning")).sort((a, b) => (a[1] < b[1] ? -1 : 1)) ==
            [["Imported planning", "2027-05-12T09:00:00"], ["Imported planning (afternoon)", "2027-05-19T14:00:00"]]
        shown.filter((entry) => entry[0] === "Imported offsite") == [["Imported offsite", "2027-05-13"]]
        again.createdCount == 0
        again.updatedCount == 3
        rowsAgain == 3
    },
})

feature("a publish link reads the calendar with its password only", {
    when() {
        setTime(15)
        logout()
        const wrong = errorOf(`${CAL}.get#PublishedCalendarEvents`, { publishToken, password: "wrong", start: "2027-05-09", end: "2027-05-15" })
        const right = call(`${CAL}.get#PublishedCalendarEvents`, { publishToken, password: "open sesame", start: "2027-05-09", end: "2027-05-15" })
        login("john.doe")
        setTime(15.1)
        const ended = as("Ada", () => call(`${CAL}.unshare#Calendar`, { calendarId: cal.projects, publish: true }).unsharedCount)
        logout()
        const after = errorOf(`${CAL}.get#PublishedCalendarEvents`, { publishToken, password: "open sesame", start: "2027-05-09", end: "2027-05-15" })
        login("john.doe")
        return { wrong, right, ended, after }
    },
    then({ wrong, right, ended, after }) {
        wrong.includes("not valid")
        right.calendarName == "Ada Projects"
        right.eventList.map((item) => item.title).sort() == ["Design review", "Focus time"]
        ended == 1
        after.includes("not valid")
    },
})

feature("the WorkEffortPartyAsset view has the asset assignment's status and dates, not the party's", {
    expect() {
        const rows = Array.from(ec.entity.find("mantle.work.effort.WorkEffortPartyAsset").condition("workEffortId", we.review)
                .condition("partyId", party.Ben).condition("assetId", "CS_PROJECTOR").list())
        const assign = ec.entity.find("mantle.work.effort.WorkEffortAssetAssign").condition("workEffortId", we.review).condition("assetId", "CS_PROJECTOR").one()
        rows.length == 1
        rows[0].assetStatusId == "WeaaAssigned"
        rows[0].partyStatusId == "WeptAssigned"
        millis(rows[0].assetFromDate) == millis(assign.fromDate)
        millis(rows[0].partyFromDate) == millis(rowOf(we.review, party.Ben).fromDate)
    },
})

feature("deleting a calendar keeps its events; deleting a subscription cancels the events of its feed", {
    when() {
        setTime(16)
        return as("Ada", () => {
            const projects = call(`${CAL}.delete#Calendar`, { calendarId: cal.projects })
            const feed = call(`${CAL}.delete#Calendar`, { calendarId: cal.feed })
            return { projects, feed }
        })
    },
    then({ projects, feed }) {
        projects.removedEventCount == 2
        projects.cancelledEventCount == 0
        ec.entity.find("mantle.work.effort.WorkEffort").condition("workEffortId", we.focus).one().statusId == "WeInPlanning"
        ec.entity.find("mantle.work.calendar.Calendar").condition("calendarId", cal.projects).one() == null
        ec.entity.find("mantle.work.calendar.CalendarShare").condition("calendarId", cal.projects).count() == 0
        feed.removedEventCount == 2
        feed.cancelledEventCount == 2
        ec.entity.find("mantle.work.calendar.CalendarSubscription").condition("calendarId", cal.feed).one() == null
    },
})

feature("an organizer outside gets an iMIP REPLY by email that carries the replying attendee only, with the answer", {
    when() {
        setTime(17)
        // Xena (an outside contact, no user) organizes; Ben and Cy are invited
        const visit = event("Supplier visit", { ownerPartyId: party.Xena, estimatedStartDate: at(30 * 24 + 10), estimatedCompletionDate: at(30 * 24 + 11) })
        invite(visit, party.Ben)
        invite(visit, party.Cy)
        const maps = call(`${EV}.get#EventIcsMaps`, { workEffortIdList: [visit] }).eventMapList
        const ben = as("Ben", () => call(`${EV}.respond#EventInvitation`, { workEffortId: visit, response: "accept" }))
        setTime(17.01)
        const cy = as("Cy", () => call(`${EV}.respond#EventInvitation`, { workEffortId: visit, response: "decline", message: "Away that week" }))
        const tool = ec.factory.getTool("ICalendar")
        // the ATTENDEE lines of the text, its folded lines joined
        const attendeeLines = (text) => String(text).replace(/\r\n[ \t]/g, "").split("\r\n").filter((line) => /^ATTENDEE[;:]/.test(line))
        const emails = Array.from(ec.entity.find("moqui.basic.email.EmailMessage").condition("toAddresses", "xena.outside@example.com")
                .condition("emailTemplateId", "MANTLE_CALENDAR_EMAIL").list()).map((row) => row.subject)
        return { maps, ben, cy, benReply: tool.parse(ben.replyIcsText), cyReply: tool.parse(cy.replyIcsText),
            benLines: attendeeLines(ben.replyIcsText), cyLines: attendeeLines(cy.replyIcsText), emails }
    },
    then({ maps, ben, cy, benReply, cyReply, benLines, cyLines, emails }) {
        // the event has both attendees; each REPLY names its replier only
        maps[0].attendees.length == 2
        ben.notifiedUserIds.length == 0
        benReply.method == "REPLY"
        benReply.events.length == 1
        benReply.events[0].summary == "Supplier visit"
        benReply.events[0].organizer.email == "xena.outside@example.com"
        benReply.events[0].attendees.map((person) => `${person.email}:${person.partstat}`) == ["cs.ben@example.com:ACCEPTED"]
        benLines.length == 1
        benLines[0].includes("PARTSTAT=ACCEPTED")
        benLines[0].endsWith(":mailto:cs.ben@example.com")
        cyReply.events[0].attendees.map((person) => `${person.email}:${person.partstat}`) == ["cs.cy@example.com:DECLINED"]
        cyLines.length == 1
        cyLines[0].includes("PARTSTAT=DECLINED")
        emails.includes("Ben Calendarspec accepted: Supplier visit")
        emails.includes("Cy Calendarspec declined: Supplier visit")
    },
})
