// The Today panel and the header badge counts (mantle.work.WorkEffortServices get#UserTodayItems and snooze#UserTodayItem,
// mantle.party.PartyServices get#ShellCounts, count#UserNotifications and handle#ShellCountsChange, the today-source
// mantle.request.RequestServices.get#UserTodayRequests), Mark done and Reschedule through mantle.work.TaskServices.update#Task,
// the ShellCounts.eecas.xml rules and the shell's NotificationTopic seeds: the Mantle side of IronStone M2. New spec, no
// Groovy original.
function errorOf(name, params) {
    try { call(name, params) } catch (e) { ec.message.clearErrors(); return String(e.message) }
    return null
}
const hour = 3600000
// Wednesday 10 June 2026 in Chicago (CDT, UTC-5), the time zone of Ada and Ben; Cy is in Tokyo, where it is already the 11th
const dayStart = Date.UTC(2026, 5, 10, 5, 0, 0)
const at = (hours) => new Date(dayStart + hours * hour)
const effectiveTime = dayStart + 14 * hour
const TODAY = "mantle.work.WorkEffortServices.get#UserTodayItems"
const SNOOZE = "mantle.work.WorkEffortServices.snooze#UserTodayItem"
const COUNTS = "mantle.party.PartyServices.get#ShellCounts"
const HANDLE = "mantle.party.PartyServices.handle#ShellCountsChange"
const WEP = "mantle.work.effort.WorkEffortParty"
const NMU = "moqui.security.user.NotificationMessageUser"
const party = {}
const user = {}
const we = {}
let themeResourceAdded = false
let mentionId, reminderId, messageId

spec({
    stepwise: true,
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(effectiveTime)
    },
    cleanupSpec() {
        if (themeResourceAdded) {
            ec.artifactExecution.disableAuthz()
            call("delete#moqui.screen.ScreenThemeResource", { screenThemeId: "DEFAULT_QUASAR", sequenceNum: 399 })
            ec.artifactExecution.enableAuthz()
        }
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() {
        ec.artifactExecution.enableAuthz()
        login("john.doe")
    },
})

// run as one of the spec's users (authz stays disabled, so only the services' own conditions apply)
function as(first, run) {
    login(`ct.${first.toLowerCase()}`, "moqui1!!")
    try { return run() } finally { login("john.doe") }
}
const today = (first, params) => as(first, () => call(TODAY, params || {}))
const titles = (items) => items.map((item) => item.title)
const itemOf = (items, title) => items.find((item) => item.title === title)
const task = (name, fields) => call("mantle.work.TaskServices.create#SimpleTask", Object.assign({ workEffortName: name }, fields)).workEffortId
const event = (name, fields) => call("mantle.work.EventServices.create#Event", Object.assign({ workEffortName: name }, fields)).workEffortId
const assign = (workEffortId, partyId) => call("mantle.work.WorkEffortServices.add#WorkEffortParty", { workEffortId, partyId,
        roleTypeId: "Assignee", statusId: "WeptAssigned" })
const rowOf = (workEffortId, partyId) => ec.entity.find(WEP).condition("workEffortId", workEffortId).condition("partyId", partyId).one()

feature("three users, two in Chicago and one in Tokyo, and their tasks, activities and events", {
    when() {
        for (const [first, timeZone] of [["Ada", "America/Chicago"], ["Ben", "America/Chicago"], ["Cy", "Asia/Tokyo"]]) {
            const username = `ct.${first.toLowerCase()}`
            party[first] = call("mantle.party.PartyServices.create#Person", { firstName: first, lastName: "Commonstoday" }).partyId
            user[first] = call("mantle.party.PartyServices.create#PartyUserAccount", { partyId: party[first], emailAddress: `${username}@example.com`,
                    username, newPassword: "moqui1!!", newPasswordVerify: "moqui1!!", timeZone }).userId
        }
        const now = ec.user.nowTimestamp
        call("create#mantle.request.Request", { requestId: "CT-REQ", requestName: "Commons request", requestTypeEnumId: "RqtSupport",
                statusId: "ReqSubmitted", requestDate: now })
        call("create#mantle.order.OrderHeader", { orderId: "CT-ORDER", orderName: "Commons order", statusId: "OrderOpen", entryDate: now })
        const ada = party.Ada
        // tasks and activities
        we.report = task("Send the overdue report", { estimatedCompletionDate: at(-31), assignToPartyId: ada, priority: 3 })
        we.order = task("Check the order", { purposeEnumId: "WepToDo", estimatedCompletionDate: at(-15), assignToPartyId: ada })
        call("mantle.work.WorkEffortServices.link#WorkEffortRecord", { workEffortId: we.order, recordEntityName: "mantle.order.OrderHeader",
                recordId: "CT-ORDER" })
        we.zone = task("Zone task", { estimatedCompletionDate: at(9), assignToPartyId: ada })
        assign(we.zone, party.Cy)
        we.budget = task("Review the budget", { estimatedCompletionDate: at(10), assignToPartyId: ada })
        we.email = task("Email the customer", { purposeEnumId: "WepEmail", estimatedCompletionDate: at(12), assignToPartyId: ada, requestId: "CT-REQ" })
        we.call = task("Call the supplier", { purposeEnumId: "WepPhoneCall", estimatedCompletionDate: at(16), assignToPartyId: ada })
        assign(we.call, party.Ben)
        we.done = task("Finished task", { estimatedCompletionDate: at(-24), statusId: "WeComplete", assignToPartyId: ada })
        we.tomorrow = task("Tomorrow task", { estimatedCompletionDate: at(34), assignToPartyId: ada })
        we.undated = task("Undated task", { assignToPartyId: ada })
        we.benOnly = task("Ben only task", { estimatedCompletionDate: at(10), assignToPartyId: party.Ben })
        // events and meetings
        we.standup = event("Standup", { purposeEnumId: "WepMeeting", estimatedStartDate: at(9), estimatedCompletionDate: at(9.25), assignToPartyId: ada })
        we.workshop = event("Workshop", { estimatedStartDate: at(13), estimatedCompletionDate: at(15), assignToPartyId: ada })
        we.planning = event("Planning", { purposeEnumId: "WepMeeting", estimatedStartDate: at(15), estimatedCompletionDate: at(16), assignToPartyId: ada })
        we.picnic = event("Company picnic", { allDayStart: "2026-06-10", assignToPartyId: ada })
        we.lunch = event("Declined lunch", { estimatedStartDate: at(16.5), estimatedCompletionDate: at(17), assignToPartyId: ada,
                assignStatusId: "WeptDeclined" })
        we.nextDay = event("Tomorrow meeting", { purposeEnumId: "WepMeeting", estimatedStartDate: at(33), estimatedCompletionDate: at(34),
                assignToPartyId: ada })
        // the counts service of the shell theme, as IronStone BOSS seeds it, unless it is there already
        const themeValues = ec.entity.find("moqui.screen.ScreenThemeResource").condition("screenThemeId", "DEFAULT_QUASAR")
                .condition("resourceTypeEnumId", "STRT_SHELL_COUNTS_SERVICE").count()
        if (themeValues === 0) {
            call("create#moqui.screen.ScreenThemeResource", { screenThemeId: "DEFAULT_QUASAR", sequenceNum: 399,
                    resourceTypeEnumId: "STRT_SHELL_COUNTS_SERVICE", resourceValue: COUNTS })
            themeResourceAdded = true
        }
        return {}
    },
    then() {
        Object.values(user).every((userId) => userId != null)
        Object.keys(we).length == 16
        Object.values(we).every((workEffortId) => workEffortId != null)
    },
})

feature("Ada's Today by group: overdue tasks, today's tasks and the events on now, later today's events", {
    when() {
        const out = today("Ada")
        return { out, supplierCall: itemOf(out.dueToday, "Call the supplier"), budget: itemOf(out.dueToday, "Review the budget"),
            picnic: itemOf(out.dueToday, "Company picnic"), workshop: itemOf(out.dueToday, "Workshop"), planning: out.laterToday[0] }
    },
    then({ out, supplierCall, budget, picnic, workshop, planning }) {
        // the declined lunch, the finished task, the ended standup, tomorrow's and the undated items are not on it
        titles(out.overdue) == ["Send the overdue report", "Check the order"]
        titles(out.dueToday) == ["Company picnic", "Zone task", "Review the budget", "Email the customer", "Workshop", "Call the supplier"]
        titles(out.laterToday) == ["Planning"]
        out.overdue.map((item) => item.kind) == ["task", "todo"]
        out.dueToday.map((item) => item.kind) == ["event", "task", "task", "email", "event", "call"]
        planning.kind == "meeting"
        // a task due later today is due today; dates as given, all day the whole of the day
        supplierCall.dueDate == at(16).getTime()
        supplierCall.statusId == "WeInPlanning"
        out.overdue[0].priority == 3
        picnic.allDay == true
        picnic.startDate == dayStart
        picnic.endDate == at(24).getTime() - 1
        workshop.startDate == at(13).getTime()
        workshop.endDate == at(15).getTime()
        workshop.allDay == false
        planning.startDate == at(15).getTime()
        // the others on it, and who may Mark done and Reschedule
        supplierCall.assignees == [{ partyId: party.Ben, name: "Ben Commonstoday" }]
        budget.assignees == []
        budget.canUpdate == true
        workshop.canUpdate == false
        planning.canUpdate == false
        out.dueToday.every((item) => item.hasCallLink === false && item.source == null)
        out.sourceGroups == []
        out.failedSources == []
        out.approvalCount == 0
    },
})

feature("an activity on a record carries the record, from the record's own join or WorkEffortRecord", {
    when() {
        const out = today("Ada")
        return { email: itemOf(out.dueToday, "Email the customer"), order: itemOf(out.overdue, "Check the order"),
            budget: itemOf(out.dueToday, "Review the budget") }
    },
    then({ email, order, budget }) {
        email.record == { recordEntityName: "mantle.request.Request", recordId: "CT-REQ", recordName: "Request CT-REQ · Commons request" }
        order.record == { recordEntityName: "mantle.order.OrderHeader", recordId: "CT-ORDER", recordName: "Order CT-ORDER · Commons order" }
        budget.record == null
    },
})

feature("the day is that of the user's time zone: in Tokyo the task due this morning in Chicago is overdue", {
    when() {
        const cy = today("Cy")
        const zone = itemOf(cy.overdue, "Zone task")
        const snooze = as("Cy", () => call(SNOOZE, { workEffortId: we.zone }))
        return { cy, zone, snooze, after: today("Cy"), ada: today("Ada") }
    },
    then({ cy, zone, snooze, after, ada }) {
        titles(cy.overdue) == ["Zone task"]
        cy.dueToday == []
        zone.assignees == [{ partyId: party.Ada, name: "Ada Commonstoday" }]
        // tomorrow 09:00 in Tokyo is the 12th there
        snooze.snoozedThruDate == Date.UTC(2026, 5, 12, 0, 0, 0)
        snooze.updatedCount == 1
        after.overdue == []
        // Cy's snooze is Cy's alone
        titles(ada.dueToday).includes("Zone task")
    },
})

feature("a snooze hides the item from that user's Today only, until tomorrow 09:00, and leaves its dates", {
    when() {
        const snooze = as("Ada", () => call(SNOOZE, { workEffortId: we.call }))
        return { snooze, ada: today("Ada"), ben: today("Ben"), adaRow: rowOf(we.call, party.Ada), benRow: rowOf(we.call, party.Ben),
            workEffort: ec.entity.find("mantle.work.effort.WorkEffort").condition("workEffortId", we.call).one() }
    },
    then({ snooze, ada, ben, adaRow, benRow, workEffort }) {
        snooze.snoozedThruDate == at(33).getTime()
        snooze.updatedCount == 1
        !titles(ada.dueToday).includes("Call the supplier")
        titles(ada.dueToday) == ["Company picnic", "Zone task", "Review the budget", "Email the customer", "Workshop"]
        titles(ben.dueToday) == ["Ben only task", "Call the supplier"]
        itemOf(ben.dueToday, "Call the supplier").assignees == [{ partyId: party.Ada, name: "Ada Commonstoday" }]
        adaRow.snoozedThruDate == at(33).getTime()
        benRow.snoozedThruDate == null
        workEffort.estimatedCompletionDate == at(16).getTime()
    },
})

feature("unsnooze shows it again, a snooze that has passed hides nothing, and only the user's own items snooze", {
    when() {
        const unsnooze = as("Ada", () => call(SNOOZE, { workEffortId: we.call, unsnooze: true }))
        const shown = today("Ada")
        const passed = as("Ada", () => call(SNOOZE, { workEffortId: we.call, snoozedThruDate: at(13) }))
        const stillShown = today("Ada")
        const notMine = as("Ada", () => errorOf(SNOOZE, { workEffortId: we.benOnly }))
        return { unsnooze, shown, passed, stillShown, notMine, row: rowOf(we.call, party.Ada) }
    },
    then({ unsnooze, shown, passed, stillShown, notMine, row }) {
        unsnooze.snoozedThruDate == null
        unsnooze.updatedCount == 1
        titles(shown.dueToday).includes("Call the supplier")
        passed.snoozedThruDate == at(13).getTime()
        titles(stillShown.dueToday).includes("Call the supplier")
        row.snoozedThruDate == at(13).getTime()
        notMine.includes("not on")
    },
})

feature("the today-sources: one returns its items as a group, one that fails and one that is not a read are left out by name", {
    when() {
        const now = ec.user.nowTimestamp
        for (const [requestId, requestName, statusId, due] of [["CT-REQ2", "Answer the question", "ReqSubmitted", at(11)],
                ["CT-REQ3", "Closed question", "ReqCompleted", at(10)], ["CT-REQ4", "Next week question", "ReqSubmitted", at(24 * 7)],
                ["CT-REQ5", "Late question", "ReqInProgress", at(-30)]]) {
            call("create#mantle.request.Request", { requestId, requestName, requestTypeEnumId: "RqtSupport", statusId, requestDate: now,
                    responseRequiredDate: due })
            call("create#mantle.request.RequestParty", { requestId, partyId: party.Ada, roleTypeId: "Assignee", fromDate: now })
        }
        const out = today("Ada", { sourceServiceNames: [
            { service: "mantle.request.RequestServices.get#UserTodayRequests", label: "Requests" },
            { service: "mantle.request.RequestServices.get#NoSuchTodayItems", label: "Broken" },
            "mantle.request.RequestServices.update#Request"] })
        return { out, group: out.sourceGroups[0] }
    },
    then({ out, group }) {
        out.sourceGroups.length == 1
        group.label == "Requests"
        group.service == "mantle.request.RequestServices.get#UserTodayRequests"
        titles(group.items) == ["Late question", "Answer the question"]
        group.items.map((item) => item.overdue) == [true, false]
        group.items.every((item) => item.kind == "request" && item.source == "Requests")
        group.items[1].dueDate == at(11).getTime()
        group.items[1].record == { recordEntityName: "mantle.request.Request", recordId: "CT-REQ2",
            recordName: "Request CT-REQ2 · Answer the question" }
        out.failedSources.map((failure) => failure.service) == ["mantle.request.RequestServices.get#NoSuchTodayItems",
            "mantle.request.RequestServices.update#Request"]
        out.failedSources[0].label == "Broken"
        out.failedSources[0].message.length > 0
        out.failedSources[1].message.includes("get or find")
        // the rest is returned
        out.overdue.length == 2
        out.dueToday.length == 6
        out.laterToday.length == 1
    },
})

feature("Mark done and Reschedule are update#Task: the task leaves Today", {
    when() {
        as("Ada", () => {
            call("mantle.work.TaskServices.update#Task", { workEffortId: we.budget, statusId: "WeComplete" })
            // a timestamp rather than date text ("2026-06-11", which reads as midnight in the session zone): a time a day ahead
            call("mantle.work.TaskServices.update#Task", { workEffortId: we.report, estimatedCompletionDate: at(24) })
        })
        const find = (id) => ec.entity.find("mantle.work.effort.WorkEffort").condition("workEffortId", id).one()
        return { out: today("Ada"), budget: find(we.budget), report: find(we.report) }
    },
    then({ out, budget, report }) {
        budget.statusId == "WeComplete"
        budget.actualCompletionDate != null
        report.estimatedCompletionDate == at(24).getTime()
        titles(out.overdue) == ["Check the order"]
        titles(out.dueToday) == ["Company picnic", "Zone task", "Email the customer", "Workshop", "Call the supplier"]
    },
})

// The unviewed notifications include Mantle's DataDocument notifications of the tasks, events, requests and messages above
// (topics MantleTask, MantleEvent, MantleRequest, MantleCommunicationEvent), sent by the data feed on a worker, so the count
// is checked against the rows once the workers are done
feature("the shell counts: Today, overdue, unviewed notifications, approvals, unread internal messages, also through the theme", {
    when() {
        const send = (topic, message) => {
            const nm = ec.makeNotificationMessage().topic(topic).message(message).userIds([user.Ada])
            nm.send()
            return nm.getNotificationMessageId()
        }
        const settled = () => ec.factory.waitWorkerPoolEmpty(100)
        const unviewed = () => ec.entity.find(NMU).condition("userId", user.Ada).condition("viewedDate", null).count()
        mentionId = send("ChatMention", { authorName: "Ben Commonstoday", roomName: "Ops", summary: "Lunch at noon?", chatRoomId: "CT-ROOM" })
        reminderId = send("WorkEffortReminder", { workEffortId: we.call, workEffortName: "Call the supplier", whenText: "at 4:00 PM" })
        settled()
        const beforeView = as("Ada", () => call(COUNTS, {}))
        call(`update#${NMU}`, { notificationMessageId: reminderId, userId: user.Ada, viewedDate: ec.user.nowTimestamp })
        const afterView = as("Ada", () => call(COUNTS, {}))
        messageId = as("Ben", () => call("mantle.party.CommunicationServices.create#Message", { subject: "Supplier call",
                body: "Can you take it?", toPartyIdList: [party.Ada] })).communicationEventId
        settled()
        const rows = unviewed()
        const counts = as("Ada", () => call(COUNTS, {}))
        const framework = as("Ada", () => call("org.moqui.impl.ShellServices.get#ShellCounts", {}))
        const internal = call(COUNTS, { userId: user.Ada })
        as("Ada", () => call("mantle.party.CommunicationServices.set#InternalMessageState", { communicationEventId: messageId, read: true }))
        const afterRead = as("Ada", () => call(COUNTS, {}))
        const title = (id) => ec.entity.find("moqui.security.user.NotificationMessage").condition("notificationMessageId", id).one().titleText
        return { beforeView, afterView, rows, counts, framework, internal, afterRead, mentionTitle: title(mentionId), reminderTitle: title(reminderId) }
    },
    then({ beforeView, afterView, rows, counts, framework, internal, afterRead, mentionTitle, reminderTitle }) {
        counts.counts.today == 6
        counts.counts.overdue == 1
        // the Notifications and the automatic Updates inbox together are every unviewed row
        counts.counts.notifications + counts.counts.updates == rows
        counts.counts.approvals == 0
        counts.counts.messages == 1
        counts.counts.email == 0
        counts.counts.chat == 0
        counts.failedParts == []
        afterView.counts.notifications == beforeView.counts.notifications - 1
        beforeView.counts.messages == 0
        framework.counts == counts.counts
        // another user's counts, for internal work (in the session's time zone, which is not Ada's here)
        internal.counts.notifications + internal.counts.updates == rows
        internal.counts.messages == 1
        internal.failedParts == []
        afterRead.counts.messages == 0
        mentionTitle == "Ben Commonstoday mentioned you in Ops: Lunch at noon?"
        reminderTitle == "Reminder: Call the supplier, at 4:00 PM"
    },
})

feature("an Updates topic counts in updates, not in the Notifications badge; an approval topic stays in notifications", {
    when() {
        call("create#moqui.security.user.NotificationTopic", { topic: "CommonsTodayUpdate", description: "Record update feed (spec)",
            inboxEnumId: "NinUpdates", persistOnSend: "Y" })
        call("create#moqui.security.user.NotificationTopic", { topic: "CommonsTodayApproval", description: "Approval (spec)",
            inboxEnumId: "NinUpdates", approveServiceName: "mantle.party.PartyServices.get#ShellCounts", persistOnSend: "Y" })
        const before = as("Ada", () => call(COUNTS, {})).counts
        for (const topic of ["CommonsTodayUpdate", "CommonsTodayApproval"])
            ec.makeNotificationMessage().topic(topic).message({ summary: topic }).userIds([user.Ada]).send()
        ec.factory.waitWorkerPoolEmpty(100)
        const after = as("Ada", () => call(COUNTS, {})).counts
        return { before, after }
    },
    then({ before, after }) {
        after.updates == before.updates + 1
        // an approval waits on the user, so it is a notification whatever inbox its topic names
        after.notifications == before.notifications + 1
        after.approvals == before.approvals + 1
    },
})

// get#UserNoticeCounts reads the week of the clock (not the pinned one), so its events are put in the clock's week; Today is
// then read at a time inside that week
feature("the old get#UserNoticeCounts counts a completed task and a declined event; Today and the shell counts do not", {
    when() {
        const old = as("Ada", () => {
            const weekStart = Number(ec.user.getPeriodRange("week", "")[0])
            const meetingAt = weekStart + (3 * 24 + 10) * hour
            we.weekMeeting = event("Week meeting", { estimatedStartDate: new Date(meetingAt), estimatedCompletionDate: new Date(meetingAt + hour),
                    assignToPartyId: party.Ada })
            we.weekLunch = event("Week lunch declined", { estimatedStartDate: new Date(meetingAt), estimatedCompletionDate: new Date(meetingAt + hour),
                    assignToPartyId: party.Ada, assignStatusId: "WeptDeclined" })
            return Object.assign({ meetingAt }, call("mantle.party.PartyServices.get#UserNoticeCounts", {}))
        })
        const juneCounts = as("Ada", () => call(COUNTS, {}))
        ec.user.setEffectiveTime(old.meetingAt + hour / 2)
        let week
        try { week = today("Ada") } finally { ec.user.setEffectiveTime(effectiveTime) }
        return { old, juneCounts, week, june: today("Ada") }
    },
    then({ old, juneCounts, week, june }) {
        // nine tasks, the finished one and the one marked done among them
        old.taskCount == 9
        old.eventCount == 2
        juneCounts.counts.today == 6
        ![...june.overdue, ...june.dueToday, ...june.laterToday].some((item) => ["Finished task", "Review the budget"].includes(item.title))
        titles(week.dueToday).includes("Week meeting")
        !titles(week.dueToday).includes("Week lunch declined")
    },
})

feature("another user's Today and counts only with authorization disabled; one's own with authorization", {
    when() {
        // Ben may call the three services, as an app screen's authz would let him, and they inherit it
        call("create#moqui.security.UserGroup", { userGroupId: "CT_TODAY", description: "Commons Today test" })
        call("create#moqui.security.ArtifactGroup", { artifactGroupId: "CT_TODAY", description: "Commons Today test" })
        for (const artifactName of [TODAY, COUNTS, "mantle.party.PartyServices.count#UserNotifications"]) {
            call("create#moqui.security.ArtifactGroupMember", { artifactGroupId: "CT_TODAY", artifactTypeEnumId: "AT_SERVICE", artifactName,
                    nameIsPattern: "N", inheritAuthz: "Y" })
        }
        call("create#moqui.security.ArtifactAuthz", { artifactAuthzId: "CT_TODAY", userGroupId: "CT_TODAY", artifactGroupId: "CT_TODAY",
                authzTypeEnumId: "AUTHZT_ALLOW", authzActionEnumId: "AUTHZA_ALL" })
        call("create#moqui.security.UserGroupMember", { userGroupId: "CT_TODAY", userId: user.Ben, fromDate: effectiveTime - 24 * hour })
        const asBen = (run) => as("Ben", () => {
            ec.artifactExecution.enableAuthz()
            try { return run() } finally { ec.artifactExecution.disableAuthz() }
        })
        return {
            todayError: asBen(() => errorOf(TODAY, { userId: user.Ada })),
            countsError: asBen(() => errorOf(COUNTS, { userId: user.Ada })),
            notificationsError: asBen(() => errorOf("mantle.party.PartyServices.count#UserNotifications", { userId: user.Ada })),
            own: asBen(() => call(TODAY, {})),
            ownCounts: asBen(() => call(COUNTS, {})),
            internal: call(TODAY, { partyId: party.Ada, countOnly: true }),
        }
    },
    then({ todayError, countsError, notificationsError, own, ownCounts, internal }) {
        todayError.includes("authorization disabled")
        countsError.includes("authorization disabled")
        notificationsError.includes("authorization disabled")
        titles(own.dueToday) == ["Ben only task", "Call the supplier"]
        itemOf(own.dueToday, "Call the supplier").assignees == [{ partyId: party.Ada, name: "Ada Commonstoday" }]
        ownCounts.counts.today == 2
        ownCounts.failedParts == []
        // countOnly: the groups without records and assignees
        internal.overdue.length == 1
        internal.overdue[0].record == null
    },
})

// The rules call handle#ShellCountsChange, which publishes through org.moqui.impl.ShellServices.publish#ShellCounts; that sends
// on a thread of its own after the commit, coalesced, so the spec reads its decisions from the service and checks that the
// writes through each rule (above: assignment, snooze, update#Task, a notification and its view, a message and its read) left
// no error.
feature("the ECAs: loaded for each counted entity, and what they publish for whom", {
    when() {
        const ruleIds = (entityName) => Array.from(ec.entity.eecaRulesByEntityName.get(entityName))
                .map((rule) => (/id="([^"]*)"/.exec(String(rule.eecaNode)) || [])[1])
        const handle = (params) => call(HANDLE, params)
        const sorted = (list) => Array.from(list).sort()
        const snoozed = handle({ entityName: WEP, eecaOperation: "update", partyId: party.Ada,
                newValues: { statusId: "WeptAssigned", thruDate: null, snoozedThruDate: at(33) },
                oldValues: { statusId: "WeptAssigned", thruDate: null, snoozedThruDate: null } })
        const unchanged = handle({ entityName: WEP, eecaOperation: "update", partyId: party.Ada,
                newValues: { statusId: "WeptAssigned", thruDate: null, snoozedThruDate: String(at(33).getTime()) },
                oldValues: { statusId: "WeptAssigned", thruDate: null, snoozedThruDate: at(33) } })
        const created = handle({ entityName: WEP, eecaOperation: "create", partyId: party.Ben })
        const statusChange = handle({ entityName: "mantle.work.effort.WorkEffort", eecaOperation: "update", workEffortId: we.call,
                newValues: { statusId: "WeComplete" }, oldValues: { statusId: "WeInPlanning" } })
        const notification = handle({ entityName: NMU, eecaOperation: "create", userId: user.Cy })
        const viewed = handle({ entityName: NMU, eecaOperation: "update", userId: user.Cy, newValues: { viewedDate: at(1) },
                oldValues: { viewedDate: null } })
        const message = handle({ entityName: "mantle.party.communication.CommunicationEventParty", eecaOperation: "update",
                partyId: party.Ada, newValues: { readDate: at(2), archivedDate: null, snoozedThruDate: null },
                oldValues: { readDate: at(2), archivedDate: null, snoozedThruDate: null } })
        const organization = handle({ entityName: "mantle.party.communication.CommunicationEventParty", eecaOperation: "create",
                partyId: "ORG_ZIZI_RETAIL" })
        const other = handle({ entityName: "mantle.order.OrderHeader", eecaOperation: "create" })
        // a removed party: the delete goes through the rule too
        assign(we.undated, party.Cy)
        const cyRow = rowOf(we.undated, party.Cy)
        cyRow.delete()
        return { rules: {
                wep: ruleIds(WEP), workEffort: ruleIds("mantle.work.effort.WorkEffort"), nmu: ruleIds(NMU),
                cep: ruleIds("mantle.party.communication.CommunicationEventParty") },
            snoozed, unchanged, created, statusChange: sorted(statusChange.publishedUserIds), notification, viewed, message,
            organization, other, removed: rowOf(we.undated, party.Cy) }
    },
    then({ rules, snoozed, unchanged, created, statusChange, notification, viewed, message, organization, other, removed }) {
        rules.wep.includes("WorkEffortPartyShellCounts")
        rules.workEffort.includes("WorkEffortShellCounts")
        rules.nmu.includes("NotificationMessageUserShellCounts")
        rules.cep.includes("CommunicationEventPartyShellCounts")
        snoozed.changed == true
        snoozed.publishedUserIds == [user.Ada]
        unchanged.changed == false
        unchanged.publishedUserIds == []
        created.publishedUserIds == [user.Ben]
        statusChange == [user.Ada, user.Ben].sort()
        notification.publishedUserIds == [user.Cy]
        viewed.publishedUserIds == [user.Cy]
        message.changed == false
        organization.changed == true
        organization.publishedUserIds == []
        other.changed == false
        removed == null
    },
})

feature("the notification topics of the shell are seeded", {
    expect() {
        const errors = checkData(`<entity-facade-xml>
            <moqui.security.user.NotificationTopic topic="ChatterMention" persistOnSend="Y" receiveNotifications="Y"/>
            <moqui.security.user.NotificationTopic topic="ChatMention" typeString="info" showAlert="Y" persistOnSend="Y"
                    receiveNotifications="Y" isPrivate="Y"/>
            <moqui.security.user.NotificationTopic topic="WorkEffortReminder" showAlert="Y" persistOnSend="Y" receiveNotifications="Y"/>
            <moqui.security.user.NotificationTopic topic="WikiPageReview" showAlert="Y" persistOnSend="Y" receiveNotifications="Y"/>
            <moqui.security.user.NotificationTopic topic="FileShare" showAlert="Y" persistOnSend="Y" receiveNotifications="Y"/>
            <moqui.security.user.NotificationTopic topic="NewMail" showAlert="Y" persistOnSend="N" receiveNotifications="Y"/>
        </entity-facade-xml>`)
        errors.length == 0
    },
})
