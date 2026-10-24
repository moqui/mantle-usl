// Record links, the record timeline, followers and mentions (mantle.party.CommunicationServices link#CommunicationEventRecord,
// get#RecordTimeline, follow#Record, log#RecordNote, notify#RecordMention; mantle.work.WorkEffortServices.link#WorkEffortRecord;
// mantle.request.RequestServices.link#RequestRecord),
// find#PartyCommunicationEvents with the recipient rows and without mailbox posts, add#WikiPageComment's
// communicationEventId, and the joins a wiki page's delete takes first (delete#WikiPageJoins): the Mantle side of IronStone
// M3 (Chatter). New spec, no Groovy original.
function errorOf(name, params) {
    try { call(name, params) } catch (e) { ec.message.clearErrors(); return String(e.message) }
    return null
}
const effectiveTime = Date.now()
const minute = 60000
// each write at its own minute, so the timeline order is known
const at = (minutes) => ec.user.setEffectiveTime(effectiveTime + minutes * minute)
const ORDER = "mantle.order.OrderHeader"
const REQUEST = "mantle.request.Request"
const WORK = "mantle.work.effort.WorkEffort"
const WIKI = "moqui.resource.wiki.WikiPage"
const PARTY = "mantle.party.Party"
const SHIPMENT = "mantle.shipment.Shipment"
const requestUrl = "/apps/Commons/Requests/RequestDetail?requestId=RL-R1"
let wikiPageId, rileyId, miaUserId, miaPartyId, noahUserId
const messageIds = {}
const partyEvents = {}

spec({
    stepwise: true,
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(effectiveTime)
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

// a message from john.doe to the organization unless the fields say otherwise
function message(subject, fields) {
    return call("mantle.party.CommunicationServices.create#Message", Object.assign({ subject, body: `${subject} body`,
        fromPartyId: "EX_JOHN_DOE", toPartyId: "ORG_ZIZI_RETAIL" }, fields || {})).communicationEventId
}
function link(communicationEventId, recordEntityName, recordId) {
    return call("mantle.party.CommunicationServices.link#CommunicationEventRecord", { communicationEventId, recordEntityName, recordId })
}
function linkActivity(workEffortId, recordEntityName, recordId) {
    return call("mantle.work.WorkEffortServices.link#WorkEffortRecord", { workEffortId, recordEntityName, recordId })
}
function linkRequest(requestId, recordEntityName, recordId) {
    return call("mantle.request.RequestServices.link#RequestRecord", { requestId, recordEntityName, recordId })
}
// run as a user with authz on, as a screen would, then back to john.doe with authz off
function asUser(username, run) {
    login(username, "moqui1!!")
    call("mantle.party.PartyServices.setup#UserOrganizationInfo", {})
    ec.artifactExecution.enableAuthz()
    try { return run() } finally {
        ec.artifactExecution.disableAuthz()
        for (const name of ["userOrgIds", "filterOrgIds", "activeOrgId"]) delete ec.user.context[name]
        login("john.doe")
    }
}
function timeline(recordEntityName, recordId, params) {
    return call("mantle.party.CommunicationServices.get#RecordTimeline", Object.assign({ recordEntityName, recordId }, params || {}))
}
// an entry as kind:what, the subject of an event, the text of a *Note row, the new value of a change
function shape(entry) {
    if (entry.kind === "change") return `change:${entry.newValue}`
    if (entry.kind === "note" && !entry.communicationEventId) return `note:${entry.body}`
    return `${entry.kind}:${entry.title}`
}
const count = (entityName, fields) => ec.entity.find(entityName).condition(fields).count()

feature("records of each kind, a mailbox and two more users", {
    when() {
        at(1)
        call("create#mantle.order.OrderHeader", { orderId: "RL-O1", orderName: "Record links order", statusId: "OrderOpen", entryDate: ec.user.nowTimestamp })
        call("create#mantle.request.Request", { requestId: "RL-R1", requestName: "Record links request", requestTypeEnumId: "RqtSupport",
                statusId: "ReqSubmitted", requestDate: ec.user.nowTimestamp })
        call("mantle.work.TaskServices.create#Task", { workEffortId: "RL-T1", workEffortName: "Record links task" })
        wikiPageId = call("create#moqui.resource.wiki.WikiPage", { wikiSpaceId: "ZZW_RETAIL", pagePath: "record-links-page" }).wikiPageId
        call("create#mantle.shipment.Shipment", { shipmentId: "RL-S1", shipmentTypeEnumId: "ShpTpSales", statusId: "ShipInput" })
        rileyId = call("mantle.party.PartyServices.create#Person", { firstName: "Riley", lastName: "Recordlink" }).partyId
        call("mantle.party.ContactServices.create#EmailAddress", { partyId: rileyId, emailAddress: "riley.recordlink@example.com",
                contactMechPurposeId: "EmailPrimary" })
        call("create#mantle.marketing.contact.ContactList", { contactListId: "RL_LIST", contactListName: "Record links mailbox" })
        for (const [first, username] of [["Mia", "rl.mia"], ["Noah", "rl.noah"]]) {
            const partyId = call("mantle.party.PartyServices.create#Person", { firstName: first, lastName: "Recordlink" }).partyId
            const userId = call("mantle.party.PartyServices.create#PartyUserAccount", { partyId, emailAddress: `${username}@example.com`, username,
                    newPassword: "moqui1!!", newPasswordVerify: "moqui1!!" }).userId
            if (first === "Mia") { miaUserId = userId; miaPartyId = partyId } else noahUserId = userId
        }
        return {}
    },
    then() {
        wikiPageId != null
        rileyId != null
        miaUserId != null
        noahUserId != null
    },
})

feature("a message filed on a record uses the record's own join, and CommunicationEventRecord for a type without one", {
    when() {
        at(2)
        const out = {}
        for (const [entityName, recordId] of [[ORDER, "RL-O1"], [REQUEST, "RL-R1"], [WORK, "RL-T1"], [WIKI, wikiPageId], [SHIPMENT, "RL-S1"]]) {
            messageIds[entityName] = message(`Filed on ${entityName.substring(entityName.lastIndexOf(".") + 1)}`)
            out[entityName] = link(messageIds[entityName], entityName, recordId)
        }
        const joins = {
            order: count("mantle.order.OrderCommunicationEvent", { orderId: "RL-O1", communicationEventId: messageIds[ORDER] }),
            request: count("mantle.request.RequestCommEvent", { requestId: "RL-R1", communicationEventId: messageIds[REQUEST] }),
            work: count("mantle.work.effort.WorkEffortCommEvent", { workEffortId: "RL-T1", communicationEventId: messageIds[WORK] }),
            wiki: count("mantle.party.communication.WikiPageCommunicationEvent", { wikiPageId, communicationEventId: messageIds[WIKI] }),
            shipment: count("mantle.party.communication.CommunicationEventRecord", { recordEntityName: SHIPMENT, recordId: "RL-S1",
                communicationEventId: messageIds[SHIPMENT] }),
        }
        // the own-join records got no generic link
        const generic = Object.values(messageIds).map((id) => count("mantle.party.communication.CommunicationEventRecord", { communicationEventId: id }))
        return { out, joins, generic }
    },
    then({ out, joins, generic }) {
        out[ORDER].linkEntityName == "mantle.order.OrderCommunicationEvent"
        out[REQUEST].linkEntityName == "mantle.request.RequestCommEvent"
        out[WORK].linkEntityName == "mantle.work.effort.WorkEffortCommEvent"
        out[WIKI].linkEntityName == "mantle.party.communication.WikiPageCommunicationEvent"
        out[SHIPMENT].linkEntityName == "mantle.party.communication.CommunicationEventRecord"
        Object.values(out).every((linked) => linked.created)
        joins == { order: 1, request: 1, work: 1, wiki: 1, shipment: 1 }
        generic == [0, 0, 0, 0, 1]
    },
})

feature("linking again changes nothing, unlinking removes the link", {
    when() {
        const again = link(messageIds[ORDER], ORDER, "RL-O1")
        const genericAgain = link(messageIds[SHIPMENT], SHIPMENT, "RL-S1")
        const orderRows = count("mantle.order.OrderCommunicationEvent", { orderId: "RL-O1" })
        const unlink = (id, entityName, recordId) => call("mantle.party.CommunicationServices.unlink#CommunicationEventRecord",
                { communicationEventId: id, recordEntityName: entityName, recordId }).unlinked
        const unlinked = unlink(messageIds[SHIPMENT], SHIPMENT, "RL-S1")
        const afterUnlink = count("mantle.party.communication.CommunicationEventRecord", { recordEntityName: SHIPMENT, recordId: "RL-S1" })
        const unlinkedAgain = unlink(messageIds[SHIPMENT], SHIPMENT, "RL-S1")
        const ownUnlinked = unlink(messageIds[WORK], WORK, "RL-T1")
        const workRows = count("mantle.work.effort.WorkEffortCommEvent", { workEffortId: "RL-T1" })
        const relinked = link(messageIds[SHIPMENT], SHIPMENT, "RL-S1")
        const ownRelinked = link(messageIds[WORK], WORK, "RL-T1")
        return { again, genericAgain, orderRows, unlinked, afterUnlink, unlinkedAgain, ownUnlinked, workRows, relinked, ownRelinked }
    },
    then({ again, genericAgain, orderRows, unlinked, afterUnlink, unlinkedAgain, ownUnlinked, workRows, relinked, ownRelinked }) {
        again.created == false
        again.linkEntityName == "mantle.order.OrderCommunicationEvent"
        genericAgain.created == false
        orderRows == 1
        unlinked == true
        afterUnlink == 0
        unlinkedAgain == false
        ownUnlinked == true
        workRows == 0
        relinked.created == true
        ownRelinked.created == true
    },
})

feature("a record type that is not an entity or has no single key is refused", {
    expect() {
        const notEntity = errorOf("mantle.party.CommunicationServices.link#CommunicationEventRecord",
                { communicationEventId: messageIds[ORDER], recordEntityName: "mantle.NoSuchRecord", recordId: "X" })
        const twoKeys = errorOf("mantle.party.CommunicationServices.link#CommunicationEventRecord",
                { communicationEventId: messageIds[ORDER], recordEntityName: "mantle.order.OrderItem", recordId: "RL-O1" })
        notEntity.includes("is not an entity")
        twoKeys.includes("primary key fields")
    },
})

feature("a party's link is the event's from or to party, or its CommunicationEventParty row", {
    when() {
        at(10)
        partyEvents.fromRiley = message("Riley writes", { fromPartyId: rileyId, toPartyId: "EX_JOHN_DOE" })
        at(11)
        // Riley a recipient row; two party rows and two purposes make several view rows of the one event
        partyEvents.watched = message("Riley watches")
        call("create#mantle.party.communication.CommunicationEventParty", { communicationEventId: partyEvents.watched, partyId: rileyId, roleTypeId: "Watcher" })
        call("create#mantle.party.communication.CommunicationEventParty", { communicationEventId: partyEvents.watched, partyId: miaPartyId, roleTypeId: "Watcher" })
        call("create#mantle.party.communication.CommunicationEventPurpose", { communicationEventId: partyEvents.watched, purposeEnumId: "CpComment" })
        call("create#mantle.party.communication.CommunicationEventPurpose", { communicationEventId: partyEvents.watched, purposeEnumId: "CpBilling" })
        at(12)
        partyEvents.about = message("About Riley")
        at(13)
        partyEvents.listPost = message("Mailbox post", { toPartyId: rileyId, contactListId: "RL_LIST" })
        const fromLink = link(partyEvents.fromRiley, PARTY, rileyId)
        const watchedLink = link(partyEvents.watched, PARTY, rileyId)
        const aboutLink = link(partyEvents.about, PARTY, rileyId)
        const aboutAgain = link(partyEvents.about, PARTY, rileyId)
        const aboutRoles = Array.from(ec.entity.find("mantle.party.communication.CommunicationEventParty")
                .condition({ communicationEventId: partyEvents.about, partyId: rileyId }).list()).map((row) => row.roleTypeId)
        const generic = count("mantle.party.communication.CommunicationEventRecord", { recordEntityName: PARTY, recordId: rileyId })
        return { fromLink, watchedLink, aboutLink, aboutAgain, aboutRoles, generic }
    },
    then({ fromLink, watchedLink, aboutLink, aboutAgain, aboutRoles, generic }) {
        fromLink.linkEntityName == "mantle.party.communication.CommunicationEvent"
        fromLink.created == false
        watchedLink.linkEntityName == "mantle.party.communication.CommunicationEventParty"
        watchedLink.created == false
        aboutLink.linkEntityName == "mantle.party.communication.CommunicationEventParty"
        aboutLink.created == true
        aboutAgain.created == false
        aboutRoles == ["_NA_"]
        generic == 0
    },
})

feature("find#PartyCommunicationEvents finds the events a party is a party to, once each, and leaves out mailbox posts", {
    when() {
        const ids = (params) => call("mantle.party.CommunicationServices.find#PartyCommunicationEvents", Object.assign({ partyId: rileyId }, params))
                .commEventList.map((commEvent) => commEvent.communicationEventId)
        return { byDefault: ids({}), withPosts: ids({ includeListPosts: true }), byList: ids({ contactListId: "RL_LIST" }),
            comments: ids({ communicationEventTypeId: "Comment" }), messages: ids({ communicationEventTypeId: "Message" }) }
    },
    then({ byDefault, withPosts, byList, comments, messages }) {
        byDefault == [partyEvents.about, partyEvents.watched, partyEvents.fromRiley]
        withPosts == [partyEvents.listPost, partyEvents.about, partyEvents.watched, partyEvents.fromRiley]
        byList == [partyEvents.listPost]
        comments.length == 0
        messages == byDefault
    },
})

feature("activities go on a request through RequestWorkEffort and on other records through WorkEffortRecord", {
    when() {
        at(5)
        call("mantle.work.TaskServices.create#Task", { workEffortId: "RL-A1", workEffortName: "Call the customer", purposeEnumId: "WepPhoneCall",
                statusId: "WeComplete", actualCompletionDate: ec.user.nowTimestamp })
        call("mantle.work.TaskServices.create#Task", { workEffortId: "RL-A2", workEffortName: "Send the quote", purposeEnumId: "WepToDo",
                estimatedCompletionDate: new Date(effectiveTime + 24 * 60 * minute), assignToPartyId: miaPartyId })
        call("mantle.work.TaskServices.create#Task", { workEffortId: "RL-A3", workEffortName: "Plain task", purposeEnumId: "WepTask" })
        const done = linkActivity("RL-A1", REQUEST, "RL-R1")
        const planned = linkActivity("RL-A2", REQUEST, "RL-R1")
        linkActivity("RL-A3", REQUEST, "RL-R1")
        const onShipment = linkActivity("RL-A1", SHIPMENT, "RL-S1")
        const again = linkActivity("RL-A1", SHIPMENT, "RL-S1")
        const onWiki = linkActivity("RL-A2", WIKI, wikiPageId)
        const unlinked = call("mantle.work.WorkEffortServices.unlink#WorkEffortRecord", { workEffortId: "RL-A2", recordEntityName: WIKI,
                recordId: wikiPageId }).unlinked
        const wikiRows = count("mantle.work.effort.WikiPageWorkEffort", { wikiPageId })
        const requestRows = count("mantle.request.RequestWorkEffort", { requestId: "RL-R1" })
        return { done, planned, onShipment, again, onWiki, unlinked, wikiRows, requestRows }
    },
    then({ done, planned, onShipment, again, onWiki, unlinked, wikiRows, requestRows }) {
        done.linkEntityName == "mantle.request.RequestWorkEffort"
        done.created
        planned.created
        onShipment.linkEntityName == "mantle.work.effort.WorkEffortRecord"
        onShipment.created
        again.created == false
        onWiki.linkEntityName == "mantle.work.effort.WikiPageWorkEffort"
        unlinked == true
        wikiRows == 0
        requestRows == 3
    },
})

feature("a note, a file and a status change on the request", {
    when() {
        at(3)
        call("create#mantle.request.RequestNote", { requestId: "RL-R1", noteDate: ec.user.nowTimestamp, noteText: "Called in about access", userId: "EX_JOHN_DOE" })
        at(4)
        call("create#mantle.request.RequestContent", { requestId: "RL-R1", contentLocation: "dbresource://mantle/content/Request/RL-R1/screenshot.png",
                description: "Screenshot", contentDate: ec.user.nowTimestamp })
        at(6)
        call("update#mantle.request.Request", { requestId: "RL-R1", statusId: "ReqReviewed" })
        return { notes: count("mantle.request.RequestNote", { requestId: "RL-R1" }), files: count("mantle.request.RequestContent", { requestId: "RL-R1" }) }
    },
    then({ notes, files }) {
        notes == 1
        files == 1
    },
})

feature("followers, and a note that mentions a user notifies them and the followers of notes", {
    when() {
        at(7)
        call("mantle.party.CommunicationServices.follow#Record", { recordEntityName: REQUEST, recordId: "RL-R1", userId: noahUserId })
        call("mantle.party.CommunicationServices.follow#Record", { recordEntityName: REQUEST, recordId: "RL-R1", kinds: "messages" })
        const followers = call("mantle.party.CommunicationServices.get#RecordFollowers", { recordEntityName: REQUEST, recordId: "RL-R1" })
        const note = call("mantle.party.CommunicationServices.log#RecordNote", { recordEntityName: REQUEST, recordId: "RL-R1", subject: "Check this",
                body: "<p>Please check the access, @Mia</p>", contentType: "text/html", mentionUserIds: [miaUserId], recordUrl: requestUrl })
        // the user's notices of the topic about this spec's request (demo data may give the same users notices of other records)
        const notices = (userId, topic) => Array.from(ec.entity.find("moqui.security.user.NotificationMessageUser").condition("userId", userId).list())
                .map((row) => ec.entity.find("moqui.security.user.NotificationMessage").condition("notificationMessageId", row.notificationMessageId).one())
                .filter((notice) => notice.topic === topic && JSON.parse(notice.messageJson || "{}").recordId === "RL-R1")
        const comment = ec.entity.find("mantle.party.communication.CommunicationEvent").condition("communicationEventId", note.communicationEventId).one()
        return { followers, note, comment, joinRows: count("mantle.request.RequestCommEvent", { requestId: "RL-R1", communicationEventId: note.communicationEventId }),
            miaMentions: notices(miaUserId, "ChatterMention"), noahFollows: notices(noahUserId, "RecordFollow"), johnFollows: notices("EX_JOHN_DOE", "RecordFollow"),
            noahMentions: notices(noahUserId, "ChatterMention") }
    },
    then({ followers, note, comment, joinRows, miaMentions, noahFollows, johnFollows, noahMentions }) {
        followers.followerList.length == 2
        followers.isFollowing
        followers.followerList.find((follower) => follower.userId === noahUserId).notifyNotes == "Y"
        followers.followerList.find((follower) => follower.userId === "EX_JOHN_DOE").notifyNotes == "N"
        followers.followerList.find((follower) => follower.userId === "EX_JOHN_DOE").notifyMessages == "Y"
        note.linkEntityName == "mantle.request.RequestCommEvent"
        joinRows == 1
        comment.communicationEventTypeId == "Comment"
        comment.fromPartyId == "EX_JOHN_DOE"
        comment.body.includes("Please check the access")
        note.mentionedUserIds == [miaUserId]
        note.notifiedFollowerUserIds == [noahUserId]
        miaMentions.length == 1
        miaMentions[0].titleText.includes("mentioned you on Request RL-R1: Check this")
        miaMentions[0].linkText == requestUrl
        noahFollows.length == 1
        noahFollows[0].titleText.includes("on Request RL-R1: Check this")
        noahMentions.length == 0
        johnFollows.length == 0
    },
})

feature("the request's timeline unions its messages, notes, activities, changes and files, newest first", {
    when() {
        at(8)
        const out = timeline(REQUEST, "RL-R1")
        return { out, entries: out.entryList.map(shape) }
    },
    then({ out, entries }) {
        entries == ["note:Check this", "change:ReqReviewed", "activity:Call the customer", "file:screenshot.png", "note:Called in about access",
            "message:Filed on Request", "change:ReqSubmitted"]
        out.failedSources.length == 0
        out.hasMore == false
        out.entryList[0].authorPartyId == "EX_JOHN_DOE"
        out.entryList[0].attachments.length == 0
        out.entryList[1].oldValueDescription == "Submitted"
        out.entryList[1].newValueDescription == "Reviewed"
        out.entryList[2].workEffortId == "RL-A1"
        out.entryList[3].contentTypeEnumId == null
        out.entryList[3].body == "Screenshot"
        out.entryList[4].authorUserId == "EX_JOHN_DOE"
        out.entryList[4].authorPartyId == "EX_JOHN_DOE"
        out.plannedActivities.length == 1
        out.plannedActivities[0].workEffortId == "RL-A2"
        out.plannedActivities[0].assigneePartyId == miaPartyId
        out.plannedActivities[0].overdue == false
    },
})

feature("the timeline by kinds, by page, and before a date", {
    when() {
        const shapes = (params) => timeline(REQUEST, "RL-R1", params).entryList.map(shape)
        const first = timeline(REQUEST, "RL-R1", { pageSize: 3 })
        return { notes: shapes({ kinds: "notes" }), messagesAndFiles: shapes({ kinds: ["messages", "files"] }), first: first.entryList.map(shape),
            firstMore: first.hasMore, second: shapes({ pageSize: 3, pageIndex: 1 }), before: shapes({ beforeDate: first.entryList[2].date }),
            activities: timeline(REQUEST, "RL-R1", { kinds: "activities" }) }
    },
    then({ notes, messagesAndFiles, first, firstMore, second, before, activities }) {
        notes == ["note:Check this", "note:Called in about access"]
        messagesAndFiles == ["file:screenshot.png", "message:Filed on Request"]
        first == ["note:Check this", "change:ReqReviewed", "activity:Call the customer"]
        firstMore == true
        second == ["file:screenshot.png", "note:Called in about access", "message:Filed on Request"]
        before == ["file:screenshot.png", "note:Called in about access", "message:Filed on Request", "change:ReqSubmitted"]
        activities.entryList.map(shape) == ["activity:Call the customer"]
        activities.plannedActivities.length == 1
    },
})

// the failing source here is a registered one naming a service that does not exist; each built-in source runs in the
// same try and catch, by name (communicationEvents, notes, activities, auditLog, content, attachments, authors)
feature("a timeline source that fails is logged and left out, and the other sources are returned", {
    when() {
        call("create#moqui.service.ServiceRegister", { serviceRegisterId: "RL_BROKEN_SOURCE", serviceTypeEnumId: "RecordTimelineSource",
                description: "A timeline source that fails", serviceName: "mantle.party.CommunicationServices.get#NoSuchTimelineEntries" })
        const out = timeline(REQUEST, "RL-R1")
        return { out, entries: out.entryList.map(shape) }
    },
    then({ out, entries }) {
        out.failedSources == ["RL_BROKEN_SOURCE"]
        entries.length == 7
        entries[0] == "note:Check this"
    },
    cleanup() { call("delete#moqui.service.ServiceRegister", { serviceRegisterId: "RL_BROKEN_SOURCE" }) },
})

feature("a party's timeline has the events it is from, to or a party to, and its notes, without mailbox posts", {
    when() {
        at(14)
        call("create#mantle.party.PartyNote", { partyId: rileyId, noteDate: ec.user.nowTimestamp, noteText: "Prefers email", userId: "EX_JOHN_DOE" })
        const shapes = (params) => timeline(PARTY, rileyId, Object.assign({ kinds: "messages,notes" }, params)).entryList.map(shape)
        const about = timeline(PARTY, rileyId, { kinds: "messages", pageSize: 1 }).entryList[0]
        return { byDefault: shapes({}), withPosts: shapes({ includeListPosts: true }), before: shapes({ beforeDate: about.date }), about: shape(about) }
    },
    then({ byDefault, withPosts, before, about }) {
        byDefault == ["note:Prefers email", "message:About Riley", "message:Riley watches", "message:Riley writes"]
        withPosts == ["note:Prefers email", "message:Mailbox post", "message:About Riley", "message:Riley watches", "message:Riley writes"]
        about == "message:About Riley"
        before == ["message:Riley watches", "message:Riley writes"]
    },
})

feature("a framework email is filed through its communication event, created once with the parties matched by address", {
    when() {
        at(15)
        call("create#moqui.basic.email.EmailMessage", { emailMessageId: "RL_EMAIL_1", statusId: "ES_RECEIVED", subject: "Shipment question",
                body: "Where is it?", contentType: "text/plain", fromAddress: "Riley Recordlink <Riley.Recordlink@example.com>",
                toAddresses: "orders@example.com", receivedDate: ec.user.nowTimestamp })
        const onShipment = call("mantle.party.CommunicationServices.link#CommunicationEventRecord", { emailMessageId: "RL_EMAIL_1",
                recordEntityName: SHIPMENT, recordId: "RL-S1" })
        const onOrder = call("mantle.party.CommunicationServices.link#CommunicationEventRecord", { emailMessageId: "RL_EMAIL_1",
                recordEntityName: ORDER, recordId: "RL-O1" })
        const event = ec.entity.find("mantle.party.communication.CommunicationEvent").condition("communicationEventId", onShipment.communicationEventId).one()
        return { onShipment, onOrder, event, events: count("mantle.party.communication.CommunicationEvent", { emailMessageId: "RL_EMAIL_1" }),
            shipment: timeline(SHIPMENT, "RL-S1", { kinds: "messages" }).entryList.map(shape) }
    },
    then({ onShipment, onOrder, event, events, shipment }) {
        onShipment.communicationEventId == onOrder.communicationEventId
        events == 1
        onShipment.linkEntityName == "mantle.party.communication.CommunicationEventRecord"
        onOrder.linkEntityName == "mantle.order.OrderCommunicationEvent"
        event.communicationEventTypeId == "Email"
        event.fromPartyId == rileyId
        event.toPartyId == null
        event.statusId == "CeReceived"
        shipment == ["message:Shipment question", "message:Filed on Shipment"]
    },
})

feature("add#WikiPageComment returns its communication event, which the wiki page's timeline shows as a note", {
    when() {
        at(16)
        const commentId = call("mantle.party.CommunicationServices.add#WikiPageComment", { wikiPageId, subject: "Wiki comment", body: "Looks right" }).communicationEventId
        return { commentId, rows: count("mantle.party.communication.WikiPageCommunicationEvent", { wikiPageId, communicationEventId: commentId }),
            wiki: timeline(WIKI, wikiPageId, { kinds: "messages,notes" }).entryList.map(shape) }
    },
    then({ commentId, rows, wiki }) {
        commentId != null
        rows == 1
        wiki == ["note:Wiki comment", "message:Filed on WikiPage"]
    },
})

feature("unfollow removes the follower", {
    when() {
        call("mantle.party.CommunicationServices.unfollow#Record", { recordEntityName: REQUEST, recordId: "RL-R1", userId: noahUserId })
        return { followers: call("mantle.party.CommunicationServices.get#RecordFollowers", { recordEntityName: REQUEST, recordId: "RL-R1" })
                .followerList.map((follower) => follower.userId) }
    },
    then({ followers }) {
        followers == ["EX_JOHN_DOE"]
    },
})

feature("a request goes on an order through RequestRecord and on a work effort or wiki page through its own join", {
    when() {
        const onOrder = linkRequest("RL-R1", ORDER, "RL-O1")
        const orderAgain = linkRequest("RL-R1", ORDER, "RL-O1")
        const orderRow = ec.entity.find("mantle.request.RequestRecord").condition({ requestId: "RL-R1", recordEntityName: ORDER, recordId: "RL-O1" }).one()
        const onWork = linkRequest("RL-R1", WORK, "RL-T1")
        const workAgain = linkRequest("RL-R1", WORK, "RL-T1")
        const onWiki = linkRequest("RL-R1", WIKI, wikiPageId)
        const linked = {
            orderRows: count("mantle.request.RequestRecord", { requestId: "RL-R1", recordEntityName: ORDER, recordId: "RL-O1" }),
            workRows: count("mantle.request.RequestWorkEffort", { requestId: "RL-R1", workEffortId: "RL-T1" }),
            workGeneric: count("mantle.request.RequestRecord", { requestId: "RL-R1", recordEntityName: WORK, recordId: "RL-T1" }),
            wikiRows: count("mantle.request.WikiPageRequest", { requestId: "RL-R1", wikiPageId }),
            wikiGeneric: count("mantle.request.RequestRecord", { requestId: "RL-R1", recordEntityName: WIKI, recordId: wikiPageId }),
        }
        const unlink = (entityName, recordId) => call("mantle.request.RequestServices.unlink#RequestRecord",
                { requestId: "RL-R1", recordEntityName: entityName, recordId }).unlinked
        const unlinkedOrder = unlink(ORDER, "RL-O1")
        const unlinkedOrderAgain = unlink(ORDER, "RL-O1")
        const unlinkedWork = unlink(WORK, "RL-T1")
        const unlinkedWiki = unlink(WIKI, wikiPageId)
        return { onOrder, orderAgain, orderRow, onWork, workAgain, onWiki, linked, unlinkedOrder, unlinkedOrderAgain, unlinkedWork, unlinkedWiki,
            orderRows: count("mantle.request.RequestRecord", { requestId: "RL-R1", recordEntityName: ORDER, recordId: "RL-O1" }),
            workRows: count("mantle.request.RequestWorkEffort", { requestId: "RL-R1", workEffortId: "RL-T1" }),
            wikiRows: count("mantle.request.WikiPageRequest", { requestId: "RL-R1", wikiPageId }) }
    },
    then({ onOrder, orderAgain, orderRow, onWork, workAgain, onWiki, linked, unlinkedOrder, unlinkedOrderAgain, unlinkedWork, unlinkedWiki,
            orderRows, workRows, wikiRows }) {
        onOrder.linkEntityName == "mantle.request.RequestRecord"
        onOrder.recordEntityName == ORDER
        onOrder.created
        orderAgain.created == false
        orderAgain.linkEntityName == "mantle.request.RequestRecord"
        orderRow.linkedByUserId == "EX_JOHN_DOE"
        orderRow.linkedDate != null
        onWork.linkEntityName == "mantle.request.RequestWorkEffort"
        onWork.created
        workAgain.created == false
        onWiki.linkEntityName == "mantle.request.WikiPageRequest"
        onWiki.created
        linked == { orderRows: 1, workRows: 1, workGeneric: 0, wikiRows: 1, wikiGeneric: 0 }
        unlinkedOrder == true
        unlinkedOrderAgain == false
        unlinkedWork == true
        unlinkedWiki == true
        orderRows == 0
        workRows == 0
        wikiRows == 0
    },
})

feature("a record the user may not see is refused, the way other record links are, and no link is written", {
    when() {
        call("create#moqui.security.UserGroup", { userGroupId: "RL_FILTERED", description: "Request record link filter" })
        call("create#moqui.security.ArtifactGroup", { artifactGroupId: "RL_FILTERED", description: "Request record link filter" })
        for (const artifactName of ["mantle.request.RequestServices.link#RequestRecord", "mantle.party.CommunicationServices.get#RecordLinkInfo"])
            call("create#moqui.security.ArtifactGroupMember", { artifactGroupId: "RL_FILTERED", artifactTypeEnumId: "AT_SERVICE",
                    artifactName, nameIsPattern: "N", inheritAuthz: "Y" })
        call("create#moqui.security.ArtifactAuthz", { artifactAuthzId: "RL_FILTERED", userGroupId: "RL_FILTERED", artifactGroupId: "RL_FILTERED",
                authzTypeEnumId: "AUTHZT_ALLOW", authzActionEnumId: "AUTHZA_ALL" })
        call("create#moqui.security.ArtifactAuthzFilter", { artifactAuthzId: "RL_FILTERED", entityFilterSetId: "MANTLE_USER_ORG" })
        const partyId = call("mantle.party.PartyServices.create#Person", { firstName: "Lee", lastName: "Recordlink" }).partyId
        const userId = call("mantle.party.PartyServices.create#PartyUserAccount", { partyId, emailAddress: "rl.lee@example.com", username: "rl.lee",
                newPassword: "moqui1!!", newPasswordVerify: "moqui1!!" }).userId
        call("create#moqui.security.UserGroupMember", { userGroupId: "RL_FILTERED", userId, fromDate: effectiveTime - 86400000 })
        const refused = asUser("rl.lee", () => errorOf("mantle.request.RequestServices.link#RequestRecord",
                { requestId: "RL-R1", recordEntityName: ORDER, recordId: "RL-O1" }))
        return { refused, rows: count("mantle.request.RequestRecord", { requestId: "RL-R1", recordEntityName: ORDER, recordId: "RL-O1" }) }
    },
    then({ refused, rows }) {
        refused != null
        refused.includes("RL-O1 not found")
        rows == 0
    },
})

feature("deleting a wiki page takes its comment, activity and follower joins first (the SECA on delete#WikiPage); the comments stay", {
    when() {
        at(17)
        call("mantle.party.CommunicationServices.follow#Record", { recordEntityName: WIKI, recordId: wikiPageId })
        linkActivity("RL-A3", WIKI, wikiPageId)
        const eventIds = ec.entity.find("mantle.party.communication.WikiPageCommunicationEvent").condition("wikiPageId", wikiPageId).list()
                .map((row) => row.communicationEventId)
        const joins = () => ({ comments: count("mantle.party.communication.WikiPageCommunicationEvent", { wikiPageId }),
            activities: count("mantle.work.effort.WikiPageWorkEffort", { wikiPageId }),
            followers: count("mantle.party.communication.RecordFollower", { recordEntityName: WIKI, recordId: wikiPageId }) })
        const before = joins()
        call("org.moqui.impl.WikiServices.delete#WikiPage", { wikiPageId })
        return { before, after: joins(), page: count(WIKI, { wikiPageId }), eventIds,
            events: ec.entity.find("mantle.party.communication.CommunicationEvent").condition("communicationEventId", "in", eventIds).count() }
    },
    then({ before, after, page, eventIds, events }) {
        before.comments == 2
        before.activities == 1
        before.followers == 1
        after == { comments: 0, activities: 0, followers: 0 }
        page == 0
        events == eventIds.length
    },
})
