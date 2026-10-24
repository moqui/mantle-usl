// The calendar gaps of IronStone M7 on the Mantle side (mantle.work.EventServices and CalendarServices): changing or
// cancelling one occurrence, this and following, or all of a recurring event (update#EventOccurrence,
// cancel#EventOccurrence), the user's declined invitations and the location and organizer in get#FullCalendarData, the
// invitation digest (get#InvitationDigest), optional attendees in the iCalendar maps, the cancel to a removed attendee
// (remove#EventAttendee), the bookings checked again when an event moves (check#ResourceBookings), an event seen through a
// shared calendar in get#RecordLinkInfo, and who may fetch a calendar subscription. New spec, no Groovy original.
function errorOf(name, params) {
    try { call(name, params) } catch (e) { ec.message.clearErrors(); return String(e.message) }
    return null
}
const hour = 3600000
const day = 24 * hour
// Monday 7 June 2027 in Chicago (CDT, UTC-5), the time zone of the spec's users; far from the real clock, so the reminder
// and fetch jobs never see these events
const dayStart = Date.UTC(2027, 5, 7, 5, 0, 0)
const at = (hours) => new Date(dayStart + hours * hour)
// before both the clock and the pinned time: the authorization checks read memberships at the clock's time
const past = Date.now() - 30 * day
const setTime = (hours) => ec.user.setEffectiveTime(dayStart + hours * hour)
const CAL = "mantle.work.CalendarServices"
const EV = "mantle.work.EventServices"
const WEP = "mantle.work.effort.WorkEffortParty"
const WORK = "mantle.work.effort.WorkEffort"
// the spec's people have first names after S, so the directory lists that show 50 people by first name (IronStone BOSS's
// Contacts spec looks for its demo contact Sam) are not pushed past by them when the suites share a database
const party = {}
const user = {}
const cal = {}
const we = {}
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

// run as one of the spec's users (authz stays disabled, so only the services' own checks apply)
function as(first, run) {
    login(`cc.${first.toLowerCase()}`, "moqui1!!")
    try { return run() } finally { login("john.doe") }
}
// run as one of the spec's users with authz on, as a screen would, the user's organizations in the user context
function asAuthorized(first, run) {
    login(`cc.${first.toLowerCase()}`, "moqui1!!")
    call("mantle.party.PartyServices.setup#UserOrganizationInfo", {})
    ec.artifactExecution.enableAuthz()
    try { return run() } finally {
        ec.artifactExecution.disableAuthz()
        for (const name of ["userOrgIds", "filterOrgIds", "activeOrgId"]) delete ec.user.context[name]
        login("john.doe")
    }
}
const event = (name, fields) => call(`${EV}.create#Event`, Object.assign({ workEffortName: name }, fields)).workEffortId
const invite = (workEffortId, partyId, fields) => call("mantle.work.WorkEffortServices.add#WorkEffortParty", Object.assign({ workEffortId, partyId,
        roleTypeId: "Assignee", statusId: "WeptOffered" }, fields || {}))
const rowOf = (workEffortId, partyId) => ec.entity.find(WEP).condition("workEffortId", workEffortId).condition("partyId", partyId)
        .condition("thruDate", null).one()
const notices = (userId, topic) => Array.from(ec.entity.find("moqui.security.user.NotificationMessageUser").condition("userId", userId).list())
        .map((row) => ec.entity.find("moqui.security.user.NotificationMessage").condition("notificationMessageId", row.notificationMessageId).one())
        .filter((notice) => notice.topic === topic)
const week = (params) => call(`${EV}.get#FullCalendarData`, Object.assign({ start: "2027-06-06", end: "2027-06-12" }, params)).eventList
const millis = (value) => value == null ? null : (value instanceof Date ? value.getTime() : (/^-?\d+$/.test(String(value)) ? Number(value) : Date.parse(String(value))))
const workEffort = (id) => ec.entity.find(WORK).condition("workEffortId", id).one()
const recurrenceOf = (id) => ec.entity.find("mantle.work.effort.WorkEffortRecurrence").condition("workEffortId", id).one()
// the weekly series' instances in the six weeks from 7 June, as [title, start]
const sixWeeks = () => as("Tara", () => call(`${EV}.get#FullCalendarData`, { start: "2027-06-06", end: "2027-07-17", calendarIdList: [cal.team],
        titleGString: "${workEffort.workEffortName}" })).eventList.filter((item) => item.title.startsWith("Weekly sync"))
        .map((item) => [item.title, item.start])

feature("five users of an organization, an outside contact, two rooms (one with an approver) and a team calendar shared three ways", {
    when() {
        for (const first of ["Tara", "Umar", "Vin", "Wren", "Yves"]) {
            const username = `cc.${first.toLowerCase()}`
            party[first] = call("mantle.party.PartyServices.create#Person", { firstName: first, lastName: "Calendarchanges" }).partyId
            user[first] = call("mantle.party.PartyServices.create#PartyUserAccount", { partyId: party[first], emailAddress: `${username}@example.com`,
                    username, newPassword: "moqui1!!", newPasswordVerify: "moqui1!!", timeZone: "America/Chicago" }).userId
            call("create#mantle.party.PartyRelationship", { relationshipTypeEnumId: "PrtEmployee", fromPartyId: party[first], fromRoleTypeId: "Employee",
                    toPartyId: "ORG_ZIZI_RETAIL", toRoleTypeId: "OrgInternal", fromDate: past })
        }
        party.Zola = call("mantle.party.PartyServices.create#Person", { firstName: "Zola", lastName: "Changes" }).partyId
        call("mantle.party.ContactServices.create#EmailAddress", { partyId: party.Zola, emailAddress: "zola.changes@example.com",
                contactMechPurposeId: "EmailPrimary" })
        call("create#mantle.facility.Facility", { facilityId: "CC_ROOM", facilityTypeEnumId: "FcTpRoom", facilityName: "Changes Room",
                ownerPartyId: "ORG_ZIZI_RETAIL" })
        call("create#mantle.facility.Facility", { facilityId: "CC_ROOM_B", facilityTypeEnumId: "FcTpRoom", facilityName: "Changes Room B",
                ownerPartyId: "ORG_ZIZI_RETAIL" })
        call("create#mantle.facility.FacilityParty", { facilityId: "CC_ROOM_B", partyId: party.Wren, roleTypeId: "BookingApprover", fromDate: dayStart - day })
        // record visibility under the user organization filter, as an app's authorization has it
        call("create#moqui.security.UserGroup", { userGroupId: "CC_FILTERED", description: "Calendar changes filtered" })
        call("create#moqui.security.ArtifactGroup", { artifactGroupId: "CC_FILTERED", description: "Calendar changes filtered" })
        for (const artifactName of ["mantle.party.CommunicationServices.get#RecordLinkInfo", `${EV}.get#InvitationDigest`])
            call("create#moqui.security.ArtifactGroupMember", { artifactGroupId: "CC_FILTERED", artifactTypeEnumId: "AT_SERVICE",
                    artifactName, nameIsPattern: "N", inheritAuthz: "Y" })
        call("create#moqui.security.ArtifactAuthz", { artifactAuthzId: "CC_FILTERED", userGroupId: "CC_FILTERED", artifactGroupId: "CC_FILTERED",
                authzTypeEnumId: "AUTHZT_ALLOW", authzActionEnumId: "AUTHZA_ALL" })
        call("create#moqui.security.ArtifactAuthzFilter", { artifactAuthzId: "CC_FILTERED", entityFilterSetId: "MANTLE_USER_ORG" })
        for (const first of ["Vin", "Wren", "Yves"]) call("create#moqui.security.UserGroupMember", { userGroupId: "CC_FILTERED", userId: user[first],
                fromDate: past })
        as("Tara", () => {
            cal.team = call(`${CAL}.create#Calendar`, { calendarName: "Tara Team", color: "#43a047" }).calendarId
            call(`${CAL}.share#Calendar`, { calendarId: cal.team, userId: user.Umar, permissionEnumId: "CalpView" })
            call(`${CAL}.share#Calendar`, { calendarId: cal.team, userId: user.Vin, permissionEnumId: "CalpView" })
            call(`${CAL}.share#Calendar`, { calendarId: cal.team, userId: user.Wren, permissionEnumId: "CalpFreeBusy" })
        })
        return {}
    },
    then() {
        Object.values(user).every((userId) => userId != null)
        cal.team != null
    },
})

feature("get#FullCalendarData: an invitation the user declined is left out even in a calendar asked for; location and organizer come with each event", {
    when() {
        setTime(8.1)
        we.planning = as("Tara", () => event("Planning", { estimatedStartDate: at(10), estimatedCompletionDate: at(11), calendarId: cal.team,
                location: "Room 5", assignToPartyId: party.Tara }))
        invite(we.planning, party.Umar)
        as("Umar", () => call(`${EV}.respond#EventInvitation`, { workEffortId: we.planning, response: "decline" }))
        const find = (list) => list.find((item) => item.workEffortId === we.planning)
        return {
            umar: find(as("Umar", () => week({ calendarIdList: [cal.team] }))),
            umarShown: find(as("Umar", () => week({ calendarIdList: [cal.team], showDeclined: true }))),
            vin: find(as("Vin", () => week({ calendarIdList: [cal.team] }))),
            wren: find(as("Wren", () => week({ calendarIdList: [cal.team] }))),
            tara: find(as("Tara", () => week({ calendarIdList: [cal.team] }))),
        }
    },
    then({ umar, umarShown, vin, wren, tara }) {
        umar == null
        umarShown.partyStatusId == "WeptDeclined"
        vin.location == "Room 5"
        vin.ownerPartyId == party.Tara
        vin.ownerName == "Tara Calendarchanges"
        vin.freeBusyOnly == false
        // free/busy: no details
        wren.freeBusyOnly == true
        wren.title == "Busy"
        wren.location == null
        wren.ownerPartyId == null
        wren.ownerName == null
        tara.location == "Room 5"
    },
})

feature("an optional attendee is OPT-PARTICIPANT and one for information NON-PARTICIPANT in the iCalendar maps and the written file", {
    when() {
        setTime(8.2)
        we.review = as("Tara", () => event("Review", { estimatedStartDate: at(13), estimatedCompletionDate: at(14), assignToPartyId: party.Tara,
                location: "Room 7" }))
        invite(we.review, party.Umar, { expectationEnumId: "WepeInvRequired" })
        invite(we.review, party.Vin, { expectationEnumId: "WepeInvRequested" })
        invite(we.review, party.Wren, { expectationEnumId: "WepeFyi" })
        const maps = as("Tara", () => call(`${EV}.get#EventIcsMaps`, { workEffortIdList: [we.review] })).eventMapList
        const text = ec.factory.getTool("ICalendar").write({ method: "REQUEST", events: maps })
        const lines = String(text).replace(/\r\n[ \t]/g, "").split("\r\n").filter((line) => /^ATTENDEE[;:]/.test(line))
        return { roles: Object.fromEntries(maps[0].attendees.map((person) => [person.email, person.role])), lines }
    },
    then({ roles, lines }) {
        roles["cc.umar@example.com"] == "REQ-PARTICIPANT"
        roles["cc.vin@example.com"] == "OPT-PARTICIPANT"
        roles["cc.wren@example.com"] == "NON-PARTICIPANT"
        lines.find((line) => line.endsWith("cc.vin@example.com")).includes("ROLE=OPT-PARTICIPANT")
    },
})

feature("get#InvitationDigest: who has the latest invitation, as send#EventInvitations decides it; a change makes everyone pending again", {
    when() {
        setTime(8.3)
        const digest = () => as("Tara", () => call(`${EV}.get#InvitationDigest`, { workEffortId: we.review }))
        const before = digest()
        as("Tara", () => call(`${EV}.send#EventInvitations`, { workEffortId: we.review }))
        const sent = digest()
        setTime(8.31)
        call("update#mantle.work.effort.WorkEffort", { workEffortId: we.review, location: "Room 9" })
        const changed = digest()
        return { before, sent, changed, umarRow: rowOf(we.review, party.Umar),
            umar: as("Umar", () => call(`${EV}.get#InvitationDigest`, { workEffortId: we.review })) }
    },
    then({ before, sent, changed, umarRow, umar }) {
        before.digest.length == 8
        before.pendingPartyIdList.sort() == [party.Umar, party.Vin, party.Wren].sort()
        before.attendeeList.every((attendee) => attendee.sentBefore == false && attendee.upToDate == false)
        sent.digest == before.digest
        sent.pendingPartyIdList == []
        sent.attendeeList.every((attendee) => attendee.upToDate == true)
        umarRow.invitationDigest == sent.digest
        changed.digest != sent.digest
        changed.pendingPartyIdList.length == 3
        changed.attendeeList.every((attendee) => attendee.sentBefore == true && attendee.upToDate == false)
        // an attendee may read it (leaving out the attendee's own row)
        umar.digest == changed.digest
        !umar.attendeeList.some((attendee) => attendee.partyId === party.Umar)
    },
})

feature("remove#EventAttendee: an attendee with an invitation is told, a user by notification, an outside contact by an iMIP CANCEL naming only them", {
    when() {
        setTime(8.4)
        invite(we.review, party.Zola)
        as("Tara", () => call(`${EV}.send#EventInvitations`, { workEffortId: we.review }))
        setTime(8.41)
        const umar = as("Tara", () => call(`${EV}.remove#EventAttendee`, { workEffortId: we.review, partyId: party.Umar, message: "Not needed after all" }))
        const zola = as("Tara", () => call(`${EV}.remove#EventAttendee`, { workEffortId: we.review, partyId: party.Zola }))
        invite(we.review, party.Yves)
        const yves = as("Tara", () => call(`${EV}.remove#EventAttendee`, { workEffortId: we.review, partyId: party.Yves }))
        const cancel = zola.cancelIcsText ? ec.factory.getTool("ICalendar").parse(zola.cancelIcsText) : null
        const umarNotices = notices(user.Umar, "EventInvitation").sort((a, b) => millis(a.sentDate) - millis(b.sentDate))
        return { umar, zola, yves, cancel, umarNotice: umarNotices[umarNotices.length - 1], umarRow: rowOf(we.review, party.Umar), zolaRow: rowOf(we.review, party.Zola),
            organizer: as("Tara", () => errorOf(`${EV}.remove#EventAttendee`, { workEffortId: we.review, partyId: party.Tara })),
            email: ec.entity.find("moqui.basic.email.EmailMessage").condition("toAddresses", "zola.changes@example.com").orderBy("-emailMessageId").list()[0] }
    },
    then({ umar, zola, yves, cancel, umarNotice, umarRow, zolaRow, organizer, email }) {
        umar.removedCount == 1
        umar.notified == true
        umar.notifiedUserIds == [user.Umar]
        umarNotice.titleText.startsWith("Tara Calendarchanges removed you from Review, ")
        JSON.parse(umarNotice.messageJson).message == "Not needed after all"
        umarRow == null
        zola.notified == true
        zola.emailedAddressList == ["zola.changes@example.com"]
        cancel.method == "CANCEL"
        cancel.events[0].status == "CANCELLED"
        cancel.events[0].attendees.map((person) => person.email) == ["zola.changes@example.com"]
        email.subject.startsWith("Cancelled: Review")
        zolaRow == null
        // never invited: nothing to cancel
        yves.removedCount == 1
        yves.notified == false
        organizer.includes("The organizer stays on the event")
    },
})

feature("update#EventOccurrence: this occurrence, the same one again, this and following with the count carried, all; attendees told", {
    when() {
        setTime(9)
        we.weekly = as("Tara", () => event("Weekly sync", { estimatedStartDate: at(15), estimatedCompletionDate: at(15.5), assignToPartyId: party.Tara,
                calendarId: cal.team, rrule: "FREQ=WEEKLY;COUNT=6", recurrenceTimeZone: "America/Chicago" }))
        invite(we.weekly, party.Umar, { statusId: "WeptAssigned" })
        as("Tara", () => {
            call(`${EV}.book#Resource`, { workEffortId: we.weekly, facilityId: "CC_ROOM" })
            call(`${EV}.send#EventInvitations`, { workEffortId: we.weekly })
        })
        const umarBefore = notices(user.Umar, "EventInvitation").length
        const start = sixWeeks()
        setTime(9.01)
        const thisOne = as("Tara", () => call(`${EV}.update#EventOccurrence`, { workEffortId: we.weekly, instanceStart: "2027-06-14 15:00", scope: "this",
                start: "2027-06-14 16:00", end: "2027-06-14 16:30", notify: "Y", eventUrl: "/apps/EventDetail" }))
        const again = as("Tara", () => call(`${EV}.update#EventOccurrence`, { workEffortId: we.weekly, instanceStart: "2027-06-14 15:00", scope: "this",
                workEffortName: "Weekly sync (late)" }))
        we.override = thisOne.targetWorkEffortId
        const link = ec.entity.find("mantle.work.effort.WorkEffortAssoc").condition("workEffortId", we.weekly).condition("toWorkEffortId", we.override).one()
        const afterThis = sixWeeks()
        setTime(9.02)
        const following = as("Tara", () => call(`${EV}.update#EventOccurrence`, { workEffortId: we.weekly, instanceStart: "2027-06-28 15:00", scope: "following",
                start: "2027-06-28 16:00", end: "2027-06-28 16:30", notify: "Y" }))
        we.next = following.targetWorkEffortId
        const afterFollowing = sixWeeks()
        setTime(9.03)
        const all = as("Tara", () => call(`${EV}.update#EventOccurrence`, { workEffortId: we.next, instanceStart: "2027-07-05 16:00", scope: "all",
                workEffortName: "Weekly sync (new)" }))
        return { umarBefore, start, thisOne, again, link, afterThis, following, afterFollowing, all,
            overrideRow: workEffort(we.override), overrideUmar: rowOf(we.override, party.Umar),
            overrideRoom: ec.entity.find("mantle.work.effort.WorkEffortFacility").condition("workEffortId", we.override).condition("facilityId", "CC_ROOM").one(),
            overrideCalendar: ec.entity.find("mantle.work.calendar.CalendarWorkEffort").condition("workEffortId", we.override).count(),
            oldRule: recurrenceOf(we.weekly).rrule, newRule: recurrenceOf(we.next).rrule, nextRow: workEffort(we.next),
            nextUmar: rowOf(we.next, party.Umar), umarNotices: notices(user.Umar, "EventInvitation").length }
    },
    then({ umarBefore, start, thisOne, again, link, afterThis, following, afterFollowing, all, overrideRow, overrideUmar, overrideRoom, overrideCalendar,
            oldRule, newRule, nextRow, nextUmar, umarNotices }) {
        start.map((entry) => entry[1]) == ["2027-06-07T15:00:00", "2027-06-14T15:00:00", "2027-06-21T15:00:00", "2027-06-28T15:00:00",
            "2027-07-05T15:00:00", "2027-07-12T15:00:00"]
        // this: an instance of its own, keyed by the rule's start, with the series' people, room and calendar
        thisOne.seriesWorkEffortId == we.weekly
        thisOne.targetWorkEffortId != we.weekly
        thisOne.notifiedCount == 1
        thisOne.message.startsWith("Event changed: ")
        thisOne.bookingList.map((booking) => [booking.facilityId, booking.statusId]) == [["CC_ROOM", "WefAssigned"]]
        thisOne.conflictList == []
        again.targetWorkEffortId == thisOne.targetWorkEffortId
        millis(link.fromDate) == at(7 * 24 + 15).getTime()
        overrideRow.workEffortName == "Weekly sync (late)"
        millis(overrideRow.estimatedStartDate) == at(7 * 24 + 16).getTime()
        overrideUmar.statusId == "WeptAssigned"
        overrideRoom.statusId == "WefAssigned"
        overrideCalendar == 1
        afterThis.filter((entry) => entry[1].startsWith("2027-06-14")) == [["Weekly sync (late)", "2027-06-14T16:00:00"]]
        afterThis.length == 6
        // this and following: the series ends before the 28th; the new one starts an hour later with the three left
        oldRule == "FREQ=WEEKLY;UNTIL=20270628T195959Z"
        newRule == "FREQ=WEEKLY;COUNT=3"
        following.seriesWorkEffortId == we.next
        following.notifiedCount == 1
        millis(nextRow.estimatedStartDate) == at(21 * 24 + 16).getTime()
        nextUmar.statusId == "WeptAssigned"
        afterFollowing == [["Weekly sync", "2027-06-07T15:00:00"], ["Weekly sync (late)", "2027-06-14T16:00:00"], ["Weekly sync", "2027-06-21T15:00:00"],
            ["Weekly sync", "2027-06-28T16:00:00"], ["Weekly sync", "2027-07-05T16:00:00"], ["Weekly sync", "2027-07-12T16:00:00"]]
        // all, with no new time: the series' own fields
        all.targetWorkEffortId == we.next
        workEffort(we.next).workEffortName == "Weekly sync (new)"
        all.bookingList == []
        umarNotices == umarBefore + 2
    },
})

feature("cancel#EventOccurrence: this occurrence by EXDATE, a changed instance cancelled, this and following by UNTIL, and a single event", {
    when() {
        setTime(10)
        const umarBefore = notices(user.Umar, "EventInvitation").length
        const third = as("Tara", () => call(`${EV}.cancel#EventOccurrence`, { workEffortId: we.weekly, instanceStart: "2027-06-21 15:00", scope: "this", notify: "Y" }))
        const umarAfter = notices(user.Umar, "EventInvitation").length
        const afterThird = sixWeeks()
        const changed = as("Tara", () => call(`${EV}.cancel#EventOccurrence`, { workEffortId: we.override, scope: "this" }))
        const afterChanged = sixWeeks()
        const following = as("Tara", () => call(`${EV}.cancel#EventOccurrence`, { workEffortId: we.next, instanceStart: "2027-07-05 16:00", scope: "following" }))
        const afterFollowing = sixWeeks()
        we.single = as("Tara", () => event("One-off", { estimatedStartDate: at(24 + 9), estimatedCompletionDate: at(24 + 10), assignToPartyId: party.Tara }))
        const single = as("Tara", () => call(`${EV}.cancel#EventOccurrence`, { workEffortId: we.single }))
        return { umarBefore, third, umarAfter, afterThird, changed, afterChanged, following, afterFollowing, single,
            exdates: recurrenceOf(we.weekly).exdates, nextRule: recurrenceOf(we.next).rrule }
    },
    then({ umarBefore, third, umarAfter, afterThird, changed, afterChanged, following, afterFollowing, single, exdates, nextRule }) {
        third.exdate == "20270621T200000Z"
        third.cancelledWorkEffortIds == []
        third.notifiedCount == 1
        umarAfter == umarBefore + 1
        !afterThird.some((entry) => entry[1].startsWith("2027-06-21"))
        changed.cancelledWorkEffortIds == [we.override]
        changed.exdate == "20270614T200000Z"
        workEffort(we.override).statusId == "WeCancelled"
        exdates == "20270621T200000Z,20270614T200000Z"
        afterChanged.map((entry) => entry[1]) == ["2027-06-07T15:00:00", "2027-06-28T16:00:00", "2027-07-05T16:00:00", "2027-07-12T16:00:00"]
        nextRule == "FREQ=WEEKLY;UNTIL=20270705T205959Z"
        following.cancelledWorkEffortIds == []
        afterFollowing.map((entry) => entry[1]) == ["2027-06-07T15:00:00", "2027-06-28T16:00:00"]
        single.cancelledWorkEffortIds == [we.single]
        workEffort(we.single).statusId == "WeCancelled"
    },
})

feature("a move checks the bookings again: a clash refuses it unless allowed, and an approved booking of a room with an approver is asked again", {
    when() {
        setTime(11)
        return as("Tara", () => {
            we.first = event("Room first", { estimatedStartDate: at(24 + 10), estimatedCompletionDate: at(24 + 11), assignToPartyId: party.Tara })
            we.second = event("Room second", { estimatedStartDate: at(24 + 13), estimatedCompletionDate: at(24 + 14), assignToPartyId: party.Tara })
            call(`${EV}.book#Resource`, { workEffortId: we.first, facilityId: "CC_ROOM" })
            call(`${EV}.book#Resource`, { workEffortId: we.second, facilityId: "CC_ROOM" })
            const clash = errorOf(`${EV}.update#EventOccurrence`, { workEffortId: we.second, start: "2027-06-08 10:30", end: "2027-06-08 11:30" })
            const unmoved = millis(workEffort(we.second).estimatedStartDate)
            const allowed = call(`${EV}.update#EventOccurrence`, { workEffortId: we.second, start: "2027-06-08 10:30", end: "2027-06-08 11:30", allowConflicts: true })
            // a room with an approver, its booking approved (assigned)
            we.roomB = event("Room B meeting", { estimatedStartDate: at(24 + 15), estimatedCompletionDate: at(24 + 16), assignToPartyId: party.Tara })
            call("create#mantle.work.effort.WorkEffortFacility", { workEffortId: we.roomB, facilityId: "CC_ROOM_B", statusId: "WefAssigned" })
            const moved = call(`${EV}.update#EventOccurrence`, { workEffortId: we.roomB, start: "2027-06-08 16:00", end: "2027-06-08 17:00" })
            const renamed = call(`${EV}.update#EventOccurrence`, { workEffortId: we.first, workEffortName: "Room first (renamed)" })
            return { clash, unmoved, allowed, moved, renamed, roomB: ec.entity.find("mantle.work.effort.WorkEffortFacility")
                    .condition("workEffortId", we.roomB).condition("facilityId", "CC_ROOM_B").one() }
        })
    },
    then({ clash, unmoved, allowed, moved, renamed, roomB }) {
        clash.includes("Changes Room is booked then: Room first")
        unmoved == at(24 + 13).getTime()
        allowed.conflictList.map((conflict) => [conflict.facilityId, conflict.workEffortId]) == [["CC_ROOM", we.first]]
        millis(workEffort(we.second).estimatedStartDate) == at(24 + 10.5).getTime()
        moved.bookingList.map((booking) => [booking.facilityId, booking.previousStatusId, booking.statusId]) == [["CC_ROOM_B", "WefAssigned", "WefRequested"]]
        roomB.statusId == "WefRequested"
        renamed.bookingList == []
    },
})

feature("get#RecordLinkInfo under the organization filter: an event in a calendar shared for viewing is visible, free/busy is not", {
    when() {
        setTime(12)
        we.everyone = as("Tara", () => event("Town hall", { estimatedStartDate: at(48 + 9), estimatedCompletionDate: at(48 + 10),
                assignToPartyId: party.Tara, visibilityEnumId: "WevAllUsers" }))
        const sees = (first, workEffortId) => asAuthorized(first, () => {
            const out = ec.service.sync().name("mantle.party.CommunicationServices.get#RecordLinkInfo").parameters({ recordEntityName: WORK,
                recordId: workEffortId, checkOnly: true }).call()
            if (ec.message.hasError()) { const errors = ec.message.getErrorsString(); ec.message.clearErrors(); return `error: ${errors}` }
            return out.recordVisible === true
        })
        return { vin: sees("Vin", we.planning), wren: sees("Wren", we.planning), yves: sees("Yves", we.planning), yvesEveryone: sees("Yves", we.everyone),
            yvesReview: sees("Yves", we.review) }
    },
    then({ vin, wren, yves, yvesEveryone, yvesReview }) {
        vin == true
        wren == false
        yves == false
        yvesEveryone == true
        // Yves was on the review and was taken off it
        yvesReview == false
    },
})

feature("a calendar subscription is fetched by the job or by a user who manages its calendar, not by another user", {
    when() {
        setTime(13)
        cal.feed = as("Tara", () => call(`${CAL}.subscribe#Calendar`, { url: "https://calendar.example.com/changes.ics", fetchNow: false })).calendarId
        // fetched a moment ago, so not due: nothing reaches the network
        call("update#mantle.work.calendar.CalendarSubscription", { calendarId: cal.feed, lastFetchDate: ec.user.nowTimestamp, lastFetchStatus: "ok" })
        const userCall = (first, name, params) => asAuthorized(first, () => {
            const out = ec.service.sync().name(name).parameters(params).call()
            if (ec.message.hasError()) { const errors = ec.message.getErrorsString(); ec.message.clearErrors(); return `error: ${errors}` }
            return out
        })
        return {
            // fetch#CalendarSubscription for one calendar has the same check as the job's service
            umar: userCall("Umar", `${CAL}.fetch#CalendarSubscription`, { calendarId: cal.feed }),
            tara: userCall("Tara", `${CAL}.fetch#CalendarSubscriptions`, { calendarId: cal.feed }),
            job: call(`${CAL}.fetch#CalendarSubscriptions`, { calendarId: cal.feed }),
        }
    },
    then({ umar, tara, job }) {
        umar.includes(`Calendar ${cal.feed} not found`)
        tara.fetchedCount == 0
        tara.failedCount == 0
        job.fetchedCount == 0
        job.failedCount == 0
    },
})
