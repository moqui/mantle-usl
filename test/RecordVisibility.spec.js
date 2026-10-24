// Which records a user may see through the record link services (mantle.party.CommunicationServices get#RecordLinkInfo
// with checkRecord or checkOnly, and so get#RecordTimeline, get#RecordFollowers and follow#Record): a request, a work effort,
// a communication event and an order have no entity filter of their own, so under an organization filter they follow
// per-user rules (IronStone R4, R5); ADMIN and an explicit entity authorization see them all; without an organization filter
// they are seen as found, except a post of a mailbox the user may not read. A wiki page follows the wiki's own view rule for
// every user (org.moqui.impl.WikiServices.get#WikiPageAccess and get#WikiViewScope: a member of a restricted space with view
// or admin, a restricted page's own viewers, the ADMIN group). The universal search's organization limit under the active
// organization filter with no active organization,
// and its wiki rule. And the timeline cursor (beforeDate with seenKeys) across entries of one date. New spec, no Groovy
// original.
function errorOf(name, params) {
    try { call(name, params) } catch (e) { ec.message.clearErrors(); return String(e.message) }
    return null
}
const effectiveTime = Date.now()
const dayMillis = 86400000
const minute = 60000
const at = (minutes) => ec.user.setEffectiveTime(effectiveTime + minutes * minute)
const COMM = "mantle.party.CommunicationServices"
const REQUEST = "mantle.request.Request"
const WORK = "mantle.work.effort.WorkEffort"
const EVENT = "mantle.party.communication.CommunicationEvent"
const ORDER = "mantle.order.OrderHeader"
const WIKI = "moqui.resource.wiki.WikiPage"
const SEARCH = "mantle.search.UniversalSearchServices.search#Universal"
const users = {}
const parties = {}
const events = {}

spec({
    stepwise: true,
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(effectiveTime)
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() {
        ec.artifactExecution.enableAuthz()
        login("john.doe")
    },
})

// run as a user with authz on, as a screen would: the user's organizations in the user context, the services authorized by
// the user's group (RV_FILTERED with MANTLE_USER_ORG, RV_ACTIVE with MANTLE_ACTIVE_ORG, RV_OPEN with no filter)
function as(username, run) {
    login(username, username === "john.doe" ? "moqui" : "moqui1!!")
    call("mantle.party.PartyServices.setup#UserOrganizationInfo", {})
    ec.artifactExecution.enableAuthz()
    try { return run() } finally {
        ec.artifactExecution.disableAuthz()
        for (const name of ["userOrgIds", "filterOrgIds", "activeOrgId"]) delete ec.user.context[name]
        login("john.doe")
    }
}
// the records each check asks about, by a short name
const records = () => ({ R1: [REQUEST, "RV-R1"], T1: [WORK, "RV-T1"], T2: [WORK, "RV-T2"], ceRequest: [EVENT, events.request],
    ceReply: [EVENT, events.reply], ceTask: [EVENT, events.task], ceToOz: [EVENT, events.toOz], cePublic: [EVENT, events.publicPost],
    cePrivate: [EVENT, events.privatePost], ceNone: [EVENT, events.unlinked] })
// the orders, wiki pages and their messages
const moreRecords = () => ({ O1: [ORDER, "RV-O1"], O2: [ORDER, "RV-O2"], ceOrder: [EVENT, events.order],
    WP1: [WIKI, "RV_WP1"], WP2: [WIKI, "RV_WP2"], WP3: [WIKI, "RV_WP3"], ceWiki: [EVENT, events.wiki] })
// what checkOnly answers for each record, with no error left
function sees(recordMap) {
    const out = {}
    for (const [name, [recordEntityName, recordId]] of Object.entries(recordMap || records())) {
        const result = ec.service.sync().name(`${COMM}.get#RecordLinkInfo`).parameters({ recordEntityName, recordId, checkOnly: true }).call()
        if (ec.message.hasError()) { out[name] = `error: ${ec.message.getErrorsString()}`; ec.message.clearErrors(); continue }
        out[name] = result.recordVisible === true
    }
    return out
}

feature("two organizations, a store, a request, a project and tasks, messages and mailboxes, and users of each kind", {
    when() {
        at(1)
        const past = effectiveTime - dayMillis
        for (const [orgId, name] of [["RV_ORG", "Visibility Works"], ["RV_ORG2", "Visibility Other"]]) {
            call("create#mantle.party.Party", { partyId: orgId, partyTypeEnumId: "PtyOrganization", ownerPartyId: "_NA_" })
            call("create#mantle.party.Organization", { partyId: orgId, organizationName: name })
            call("create#mantle.party.PartyRole", { partyId: orgId, roleTypeId: "OrgInternal" })
        }
        // the groups: services authorized with the user organization filter, the active organization filter, or none
        const services = ["get#RecordLinkInfo", "get#RecordTimeline", "get#RecordFollowers", "follow#Record"].map((verbNoun) => `${COMM}.${verbNoun}`)
        for (const [groupId, filterSetId] of [["RV_FILTERED", "MANTLE_USER_ORG"], ["RV_ACTIVE", "MANTLE_ACTIVE_ORG"], ["RV_OPEN", null]]) {
            call("create#moqui.security.UserGroup", { userGroupId: groupId, description: `Record visibility ${groupId}` })
            call("create#moqui.security.ArtifactGroup", { artifactGroupId: groupId, description: `Record visibility ${groupId}` })
            for (const artifactName of services) call("create#moqui.security.ArtifactGroupMember", { artifactGroupId: groupId,
                    artifactTypeEnumId: "AT_SERVICE", artifactName, nameIsPattern: "N", inheritAuthz: "Y" })
            call("create#moqui.security.ArtifactAuthz", { artifactAuthzId: groupId, userGroupId: groupId, artifactGroupId: groupId,
                    authzTypeEnumId: "AUTHZT_ALLOW", authzActionEnumId: "AUTHZA_ALL" })
            if (filterSetId) call("create#moqui.security.ArtifactAuthzFilter", { artifactAuthzId: groupId, entityFilterSetId: filterSetId })
        }
        // staff: an explicit entity authorization to view every request
        call("create#moqui.security.UserGroup", { userGroupId: "RV_STAFF", description: "Record visibility request staff" })
        call("create#moqui.security.ArtifactGroup", { artifactGroupId: "RV_STAFF", description: "Record visibility request staff" })
        call("create#moqui.security.ArtifactGroupMember", { artifactGroupId: "RV_STAFF", artifactTypeEnumId: "AT_ENTITY",
                artifactName: REQUEST, nameIsPattern: "N", inheritAuthz: "N" })
        call("create#moqui.security.ArtifactAuthz", { artifactAuthzId: "RV_STAFF", userGroupId: "RV_STAFF", artifactGroupId: "RV_STAFF",
                authzTypeEnumId: "AUTHZT_ALLOW", authzActionEnumId: "AUTHZA_VIEW" })
        // Pat a party to the request and the task, Mo and Ace employees of RV_ORG, Oz of RV_ORG2, Stan request staff, Opal
        // with no organization filter, Axel with the active organization filter and no organization
        for (const [first, username, groups, orgId] of [["Pat", "rv.pat", ["RV_FILTERED"], null], ["Mo", "rv.mo", ["RV_FILTERED"], "RV_ORG"],
            ["Oz", "rv.oz", ["RV_FILTERED"], "RV_ORG2"], ["Stan", "rv.stan", ["RV_FILTERED", "RV_STAFF"], null],
            ["Opal", "rv.opal", ["RV_OPEN"], null], ["Ace", "rv.ace", ["RV_ACTIVE"], "RV_ORG"], ["Axel", "rv.axel", ["RV_ACTIVE"], null]]) {
            const partyId = call("mantle.party.PartyServices.create#Person", { firstName: first, lastName: "Visibility" }).partyId
            users[first] = call("mantle.party.PartyServices.create#PartyUserAccount", { partyId, emailAddress: `${username}@example.com`, username,
                    newPassword: "moqui1!!", newPasswordVerify: "moqui1!!" }).userId
            parties[first] = partyId
            for (const userGroupId of groups) call("create#moqui.security.UserGroupMember", { userGroupId, userId: users[first], fromDate: past })
            if (orgId) call("create#mantle.party.PartyRelationship", { relationshipTypeEnumId: "PrtEmployee", fromPartyId: partyId,
                    fromRoleTypeId: "Employee", toPartyId: orgId, toRoleTypeId: "OrgInternal", fromDate: past })
        }
        call("create#moqui.security.UserGroupMember", { userGroupId: "RV_FILTERED", userId: "EX_JOHN_DOE", fromDate: past })

        // the request: of RV_ORG's store, Pat a customer party, with a file
        call("create#mantle.product.store.ProductStore", { productStoreId: "RV_STORE", storeName: "Visibility Store", organizationPartyId: "RV_ORG" })
        call("create#mantle.request.Request", { requestId: "RV-R1", requestName: "Visibility request", requestTypeEnumId: "RqtSupport",
                statusId: "ReqSubmitted", requestDate: ec.user.nowTimestamp, productStoreId: "RV_STORE" })
        call("create#mantle.request.RequestParty", { requestId: "RV-R1", partyId: parties.Pat, roleTypeId: "Customer", fromDate: past })
        call("create#mantle.request.RequestContent", { requestId: "RV-R1", contentLocation: "dbresource://mantle/content/Request/RV-R1/log.txt",
                description: "Log", contentDate: ec.user.nowTimestamp })
        // a task of RV_ORG Pat is assigned to; a project Oz is a party to, and a task in it of nobody's here
        call("mantle.work.TaskServices.create#Task", { workEffortId: "RV-T1", workEffortName: "Visibility task", ownerPartyId: "RV_ORG",
                assignToPartyId: parties.Pat })
        call("create#mantle.work.effort.WorkEffort", { workEffortId: "RV-P1", workEffortTypeEnumId: "WetProject", workEffortName: "Visibility project",
                statusId: "WeInPlanning", ownerPartyId: "EX_JOHN_DOE" })
        call("create#mantle.work.effort.WorkEffortParty", { workEffortId: "RV-P1", partyId: parties.Oz, roleTypeId: "Assignee", fromDate: past })
        call("mantle.work.TaskServices.create#Task", { workEffortId: "RV-T2", rootWorkEffortId: "RV-P1", workEffortName: "Visibility project task",
                ownerPartyId: "EX_JOHN_DOE" })

        // messages: filed on the request, a reply in its thread, filed on the task, to Oz, and one on nothing
        const message = (subject, fields) => call(`${COMM}.create#Message`, Object.assign({ subject, body: `${subject} body`,
                fromPartyId: "EX_JOHN_DOE", toPartyId: "ORG_ZIZI_RETAIL" }, fields || {})).communicationEventId
        events.request = message("On the request")
        call(`${COMM}.link#CommunicationEventRecord`, { communicationEventId: events.request, recordEntityName: REQUEST, recordId: "RV-R1" })
        events.reply = message("Re: On the request", { parentCommEventId: events.request })
        events.task = message("On the task")
        call(`${COMM}.link#CommunicationEventRecord`, { communicationEventId: events.task, recordEntityName: WORK, recordId: "RV-T1" })
        events.toOz = message("To Oz", { toPartyId: parties.Oz })
        events.unlinked = message("On nothing")
        // a post of a public mailbox (anyone may read) and of a private one (its members only; it has none)
        for (const [contactListId, isPublic] of [["RV_PUBLIC", "Y"], ["RV_PRIVATE", "N"]]) {
            call("create#mantle.marketing.contact.ContactList", { contactListId, contactListName: `Visibility ${contactListId}`,
                    contactListTypeEnumId: "MAILBOX", isPublic, postingEnumId: "ClpMembers" })
        }
        const post = (subject, contactListId) => call(`create#${EVENT}`, { communicationEventTypeId: "Message", contactMechTypeEnumId: "CmtWebForm",
                statusId: "CeSent", fromPartyId: "EX_JOHN_DOE", contactListId, subject, body: subject, entryDate: ec.user.nowTimestamp }).communicationEventId
        events.publicPost = post("Public post", "RV_PUBLIC")
        events.privatePost = post("Private post", "RV_PRIVATE")
        const reply = ec.entity.find(EVENT).condition("communicationEventId", events.reply).one()
        return { reply }
    },
    then({ reply }) {
        Object.keys(users).length == 7
        reply.rootCommEventId == events.request
        Object.values(events).every((id) => id != null)
    },
})

feature("under the user organization filter: a party, an organization member, request staff, another organization's member, ADMIN", {
    when() {
        at(2)
        return { pat: as("rv.pat", sees), mo: as("rv.mo", sees), stan: as("rv.stan", sees), oz: as("rv.oz", sees), admin: as("john.doe", sees) }
    },
    then({ pat, mo, stan, oz, admin }) {
        // Pat: the request and the task as a party, the messages filed on them and the reply in the request's thread, the public post
        pat == { R1: true, T1: true, T2: false, ceRequest: true, ceReply: true, ceTask: true, ceToOz: false, cePublic: true, cePrivate: false, ceNone: false }
        // Mo: the request by its store's organization, the task by its owner
        mo == { R1: true, T1: true, T2: false, ceRequest: true, ceReply: true, ceTask: true, ceToOz: false, cePublic: true, cePrivate: false, ceNone: false }
        // Stan: every request (an explicit entity authorization) and so its messages, no task
        stan == { R1: true, T1: false, T2: false, ceRequest: true, ceReply: true, ceTask: false, ceToOz: false, cePublic: true, cePrivate: false, ceNone: false }
        // Oz: the project task by the project's party row, the message to Oz, the public post; not the request or the task
        oz == { R1: false, T1: false, T2: true, ceRequest: false, ceReply: false, ceTask: false, ceToOz: true, cePublic: true, cePrivate: false, ceNone: false }
        admin == { R1: true, T1: true, T2: true, ceRequest: true, ceReply: true, ceTask: true, ceToOz: true, cePublic: true, cePrivate: true, ceNone: true }
    },
})

feature("the active organization filter with no active organization covers all of the user's organizations; no filter sees all but a private mailbox", {
    when() {
        return { ace: as("rv.ace", sees), axel: as("rv.axel", sees), opal: as("rv.opal", sees) }
    },
    then({ ace, axel, opal }) {
        ace.R1 == true
        ace.T1 == true
        ace.T2 == false
        ace.ceToOz == false
        axel.R1 == false
        axel.T1 == false
        axel.ceRequest == false
        axel.cePublic == true
        opal == { R1: true, T1: true, T2: true, ceRequest: true, ceReply: true, ceTask: true, ceToOz: true, cePublic: true, cePrivate: false, ceNone: true }
    },
})

// which records each user sees is checked with checkOnly; here a read and a write are refused, by the same check
feature("a user who may not see a request reads none of its timeline and cannot follow it", {
    when() {
        const oz = as("rv.oz", () => ({ timeline: errorOf(`${COMM}.get#RecordTimeline`, { recordEntityName: REQUEST, recordId: "RV-R1" }),
            follow: errorOf(`${COMM}.follow#Record`, { recordEntityName: REQUEST, recordId: "RV-R1" }) }))
        const followers = ec.entity.find("mantle.party.communication.RecordFollower").condition({ recordId: "RV-R1", userId: users.Oz }).count()
        return { oz, followers }
    },
    then({ oz, followers }) {
        oz.timeline.includes("RV-R1 not found")
        oz.follow.includes("RV-R1 not found")
        followers == 0
    },
})

feature("a party, an organization member and ADMIN read the request's timeline, files and followers, and follow it", {
    when() {
        const read = () => {
            const timeline = call(`${COMM}.get#RecordTimeline`, { recordEntityName: REQUEST, recordId: "RV-R1" })
            const files = call(`${COMM}.get#RecordTimeline`, { recordEntityName: REQUEST, recordId: "RV-R1", kinds: "files" })
            call(`${COMM}.follow#Record`, { recordEntityName: REQUEST, recordId: "RV-R1" })
            const followers = call(`${COMM}.get#RecordFollowers`, { recordEntityName: REQUEST, recordId: "RV-R1" })
            const taskInfo = call(`${COMM}.get#RecordLinkInfo`, { recordEntityName: WORK, recordId: "RV-T1" })
            return { titles: timeline.entryList.map((entry) => entry.title), files: files.entryList.map((entry) => entry.title),
                isFollowing: followers.isFollowing, taskVisible: taskInfo.recordVisible }
        }
        return { pat: as("rv.pat", read), mo: as("rv.mo", read), admin: as("john.doe", read) }
    },
    then({ pat, mo, admin }) {
        pat.titles.includes("On the request")
        pat.titles.includes("Re: On the request")
        pat.files == ["log.txt"]
        pat.isFollowing
        pat.taskVisible == true
        mo.files == ["log.txt"]
        mo.isFollowing
        mo.titles == pat.titles
        admin.files == ["log.txt"]
        admin.isFollowing
    },
})

feature("checkOnly answers recordVisible with no error, for a record not seen, a type that is not one, and with authorization off", {
    when() {
        const raw = (params) => {
            const out = ec.service.sync().name(`${COMM}.get#RecordLinkInfo`).parameters(Object.assign({ checkOnly: true }, params)).call()
            const errors = ec.message.hasError() ? ec.message.getErrorsString() : null
            ec.message.clearErrors()
            return { visible: out?.recordVisible ?? null, reason: out?.notVisibleReason ?? null, entityName: out?.recordEntityName ?? null, errors }
        }
        const oz = as("rv.oz", () => ({ request: raw({ recordEntityName: REQUEST, recordId: "RV-R1" }),
            notEntity: raw({ recordEntityName: "mantle.NoSuchRecord", recordId: "X" }), missing: raw({ recordEntityName: REQUEST, recordId: "RV-NONE" }),
            own: raw({ recordEntityName: EVENT, recordId: events.toOz }) }))
        // authorization disabled (an internal caller): no per-user rule
        const internal = raw({ recordEntityName: REQUEST, recordId: "RV-R1" })
        const unchecked = call(`${COMM}.get#RecordLinkInfo`, { recordEntityName: REQUEST, recordId: "RV-R1", checkRecord: false })
        return { oz, internal, unchecked }
    },
    then({ oz, internal, unchecked }) {
        oz.request.visible == false
        oz.request.errors == null
        oz.request.reason.includes("RV-R1 not found")
        oz.request.entityName == REQUEST
        oz.notEntity.visible == false
        oz.notEntity.errors == null
        oz.notEntity.reason.includes("is not an entity")
        oz.missing.visible == false
        oz.missing.errors == null
        oz.own.visible == true
        oz.own.errors == null
        internal.visible == true
        unchecked.recordVisible == null
    },
})

// five entries at one minute (a note, a file, two messages, a status change) between the created status and a later message
feature("the timeline cursor pages through entries of one date with no entry skipped or repeated; beforeDate alone skips them", {
    when() {
        at(20)
        call("create#mantle.request.Request", { requestId: "RV-R3", requestName: "Cursor request", requestTypeEnumId: "RqtSupport",
                statusId: "ReqSubmitted", requestDate: ec.user.nowTimestamp })
        at(21)
        const fileOn = (subject) => {
            const communicationEventId = call(`${COMM}.create#Message`, { subject, body: subject, fromPartyId: "EX_JOHN_DOE",
                    toPartyId: "ORG_ZIZI_RETAIL" }).communicationEventId
            call(`${COMM}.link#CommunicationEventRecord`, { communicationEventId, recordEntityName: REQUEST, recordId: "RV-R3" })
        }
        call("create#mantle.request.RequestNote", { requestId: "RV-R3", noteDate: ec.user.nowTimestamp, noteText: "Same minute note", userId: "EX_JOHN_DOE" })
        call("create#mantle.request.RequestContent", { requestId: "RV-R3", contentLocation: "dbresource://mantle/content/Request/RV-R3/same.txt",
                contentDate: ec.user.nowTimestamp })
        fileOn("Same minute one")
        fileOn("Same minute two")
        call("update#mantle.request.Request", { requestId: "RV-R3", statusId: "ReqReviewed" })
        at(22)
        fileOn("Later message")
        at(23)
        const timeline = (params) => call(`${COMM}.get#RecordTimeline`, Object.assign({ recordEntityName: REQUEST, recordId: "RV-R3", pageSize: 2 }, params))
        const all = call(`${COMM}.get#RecordTimeline`, { recordEntityName: REQUEST, recordId: "RV-R3" }).entryList.map((entry) => entry.entryKey)
        // the cursor: each page's nextBeforeDate and nextSeenKeys (once as comma-separated text)
        const paged = []
        const pageSizes = []
        let cursor = {}
        for (let pageNum = 0; pageNum < 10; pageNum++) {
            const params = pageNum === 2 ? { beforeDate: cursor.beforeDate, seenKeys: cursor.seenKeys.join(",") } : cursor
            const out = timeline(params)
            pageSizes.push(out.entryList.length)
            for (const entry of out.entryList) paged.push(entry.entryKey)
            if (!out.hasMore) break
            cursor = { beforeDate: out.nextBeforeDate, seenKeys: out.nextSeenKeys }
        }
        // beforeDate alone: strictly before the last date shown
        const strict = []
        let beforeDate = null
        for (let pageNum = 0; pageNum < 10; pageNum++) {
            const out = timeline(beforeDate ? { beforeDate } : {})
            for (const entry of out.entryList) strict.push(entry.entryKey)
            if (!out.hasMore) break
            beforeDate = out.entryList[out.entryList.length - 1].date
        }
        const sameMinute = new Date(effectiveTime + 21 * minute).getTime()
        const firstPage = timeline({})
        return { all, paged, pageSizes, strict, firstPage, sameMinute }
    },
    then({ all, paged, pageSizes, strict, firstPage, sameMinute }) {
        all.length == 7
        new Set(all).size == 7
        paged == all
        pageSizes == [2, 2, 2, 1]
        strict.length < all.length
        Number(firstPage.nextBeforeDate) == sameMinute
        firstPage.nextSeenKeys == [firstPage.entryList[1].entryKey]
    },
})

feature("orders of two organizations with a bill-to party, a customer and an enterer; an open and a restricted wiki space and a restricted page", {
    when() {
        at(30)
        // RV-O1: RV_ORG sells to ORG_ZIZI_RETAIL, Pat its bill-to party, with a message filed on it; RV-O2: ORG_ZIZI_RETAIL
        // sells to Pat, and Oz entered it
        call("create#mantle.order.OrderHeader", { orderId: "RV-O1", orderName: "Visibility order one", statusId: "OrderOpen",
                entryDate: ec.user.nowTimestamp })
        call("create#mantle.order.OrderPart", { orderId: "RV-O1", orderPartSeqId: "01", vendorPartyId: "RV_ORG", customerPartyId: "ORG_ZIZI_RETAIL" })
        call("create#mantle.order.OrderPartParty", { orderId: "RV-O1", orderPartSeqId: "01", partyId: parties.Pat, roleTypeId: "CustomerBillTo" })
        call("create#mantle.order.OrderHeader", { orderId: "RV-O2", orderName: "Visibility order two", statusId: "OrderOpen",
                entryDate: ec.user.nowTimestamp, enteredByPartyId: parties.Oz })
        call("create#mantle.order.OrderPart", { orderId: "RV-O2", orderPartSeqId: "01", vendorPartyId: "ORG_ZIZI_RETAIL", customerPartyId: parties.Pat })
        events.order = call(`${COMM}.create#Message`, { subject: "On the order", body: "On the order body", fromPartyId: "EX_JOHN_DOE",
                toPartyId: "ORG_ZIZI_RETAIL" }).communicationEventId
        call(`${COMM}.link#CommunicationEventRecord`, { communicationEventId: events.order, recordEntityName: ORDER, recordId: "RV-O1" })
        // an open space and a restricted one Mo may view; Oz has a row of it with update and admin but not view
        for (const [wikiSpaceId, restrictView] of [["RVWOPEN", "N"], ["RVWSHUT", "Y"]]) {
            call("create#moqui.resource.wiki.WikiSpace", { wikiSpaceId, description: `Visibility space ${wikiSpaceId}`, restrictView,
                    restrictUpdate: restrictView })
        }
        call("create#moqui.resource.wiki.WikiSpaceUser", { wikiSpaceId: "RVWSHUT", userId: users.Mo, allowView: "Y", allowUpdate: "Y" })
        call("create#moqui.resource.wiki.WikiSpaceUser", { wikiSpaceId: "RVWSHUT", userId: users.Oz, allowView: "N", allowUpdate: "Y", allowAdmin: "Y" })
        // a page of each space, and a restricted page of the open space Pat may view; a comment on the restricted space's page
        call("create#moqui.resource.wiki.WikiPage", { wikiPageId: "RV_WP1", wikiSpaceId: "RVWOPEN", pagePath: "visibility-open" })
        call("create#moqui.resource.wiki.WikiPage", { wikiPageId: "RV_WP2", wikiSpaceId: "RVWSHUT", pagePath: "visibility-shut" })
        call("create#moqui.resource.wiki.WikiPage", { wikiPageId: "RV_WP3", wikiSpaceId: "RVWOPEN", pagePath: "visibility-private", restrictView: "Y" })
        call("create#moqui.resource.wiki.WikiPageUser", { wikiPageId: "RV_WP3", userId: users.Pat, allowView: "Y" })
        events.wiki = call(`${COMM}.add#WikiPageComment`, { wikiPageId: "RV_WP2", subject: "On the shut page", body: "A comment" }).communicationEventId
        return { orderLinks: ec.entity.find("mantle.order.OrderCommunicationEvent").condition("orderId", "RV-O1").count() }
    },
    then({ orderLinks }) {
        orderLinks == 1
        events.order != null
        events.wiki != null
    },
})

feature("an order is seen by its organizations' members, its parties and its enterer, a wiki page by the wiki's rule, ADMIN included", {
    when() {
        at(31)
        const run = () => sees(moreRecords())
        const internal = sees(moreRecords())
        return { pat: as("rv.pat", run), mo: as("rv.mo", run), oz: as("rv.oz", run), stan: as("rv.stan", run), ace: as("rv.ace", run),
            axel: as("rv.axel", run), opal: as("rv.opal", run), admin: as("john.doe", run), internal }
    },
    then({ pat, mo, oz, stan, ace, axel, opal, admin, internal }) {
        // Pat: RV-O1 as its bill-to party and so its message, RV-O2 as its customer; the open page and the page Pat may view
        pat == { O1: true, O2: true, ceOrder: true, WP1: true, WP2: false, WP3: true, ceWiki: false }
        // Mo: RV-O1 by its vendor organization; the restricted space as a member, and the comment on its page
        mo == { O1: true, O2: false, ceOrder: true, WP1: true, WP2: true, WP3: false, ceWiki: true }
        // Oz: RV-O2 as its enterer; the restricted space as its administrator (a row with allowAdmin, without allowView), and
        // so the comment on its page
        oz == { O1: false, O2: true, ceOrder: false, WP1: true, WP2: true, WP3: false, ceWiki: true }
        // Stan: request staff only
        stan == { O1: false, O2: false, ceOrder: false, WP1: true, WP2: false, WP3: false, ceWiki: false }
        // the active organization filter with no active organization: all of Ace's organizations, none of Axel's
        ace == { O1: true, O2: false, ceOrder: true, WP1: true, WP2: false, WP3: false, ceWiki: false }
        axel == { O1: false, O2: false, ceOrder: false, WP1: true, WP2: false, WP3: false, ceWiki: false }
        // no organization filter: every order, and still the wiki's rule, also for a comment on a page Opal may not see
        opal == { O1: true, O2: true, ceOrder: true, WP1: true, WP2: false, WP3: false, ceWiki: false }
        // ADMIN: every order and message, and every wiki page, as the wiki's own rule
        admin == { O1: true, O2: true, ceOrder: true, WP1: true, WP2: true, WP3: true, ceWiki: true }
        // authorization disabled: all
        internal == { O1: true, O2: true, ceOrder: true, WP1: true, WP2: true, WP3: true, ceWiki: true }
    },
})

feature("a user who may not see a wiki page reads none of its timeline; a member reads the wiki page's", {
    when() {
        const oz = as("rv.oz", () => errorOf(`${COMM}.get#RecordTimeline`, { recordEntityName: WIKI, recordId: "RV_WP3" }))
        const mo = as("rv.mo", () => call(`${COMM}.get#RecordTimeline`, { recordEntityName: WIKI, recordId: "RV_WP2", kinds: "messages,notes" })
                .entryList.map((entry) => entry.title))
        return { oz, mo }
    },
    then({ oz, mo }) {
        oz.includes("RV_WP3 not found")
        mo.includes("On the shut page")
    },
})

feature("search#Universal limits the active organization filter with no active organization to the user's organizations, beside the personal contact filter too, and wiki pages by the wiki's rule", {
    when() {
        at(32)
        const past = effectiveTime - dayMillis
        // the groups search too; RV_BOSS has the IronStone apps' filter sets, the active organization and personal contact ones
        for (const groupId of ["RV_FILTERED", "RV_ACTIVE", "RV_OPEN"]) call("create#moqui.security.ArtifactGroupMember", { artifactGroupId: groupId,
                artifactTypeEnumId: "AT_SERVICE", artifactName: SEARCH, nameIsPattern: "N", inheritAuthz: "Y" })
        call("create#moqui.security.UserGroup", { userGroupId: "RV_BOSS", description: "Record visibility RV_BOSS" })
        call("create#moqui.security.ArtifactGroup", { artifactGroupId: "RV_BOSS", description: "Record visibility RV_BOSS" })
        for (const artifactName of [SEARCH, `${COMM}.get#RecordLinkInfo`]) call("create#moqui.security.ArtifactGroupMember", { artifactGroupId: "RV_BOSS",
                artifactTypeEnumId: "AT_SERVICE", artifactName, nameIsPattern: "N", inheritAuthz: "Y" })
        call("create#moqui.security.ArtifactAuthz", { artifactAuthzId: "RV_BOSS", userGroupId: "RV_BOSS", artifactGroupId: "RV_BOSS",
                authzTypeEnumId: "AUTHZT_ALLOW", authzActionEnumId: "AUTHZA_ALL" })
        for (const entityFilterSetId of ["MANTLE_ACTIVE_ORG", "MANTLE_PRIVATE_CONTACT"])
            call("create#moqui.security.ArtifactAuthzFilter", { artifactAuthzId: "RV_BOSS", entityFilterSetId })
        // Bea, an employee of RV_ORG with RV_BOSS
        const partyId = call("mantle.party.PartyServices.create#Person", { firstName: "Bea", lastName: "Visibility" }).partyId
        users.Bea = call("mantle.party.PartyServices.create#PartyUserAccount", { partyId, emailAddress: "rv.bea@example.com", username: "rv.bea",
                newPassword: "moqui1!!", newPasswordVerify: "moqui1!!" }).userId
        parties.Bea = partyId
        call("create#moqui.security.UserGroupMember", { userGroupId: "RV_BOSS", userId: users.Bea, fromDate: past })
        call("create#mantle.party.PartyRelationship", { relationshipTypeEnumId: "PrtEmployee", fromPartyId: partyId, fromRoleTypeId: "Employee",
                toPartyId: "RV_ORG", toRoleTypeId: "OrgInternal", fromDate: past })

        // index the records now rather than wait for the data feed's worker
        const index = (documentId, keyField, ids) => {
            for (const id of ids) ec.search.indexDocuments(ec.entity.getDataDocuments(documentId, { [keyField]: id }))
        }
        index("MantleTask", "workEffortId", ["RV-T1", "RV-T2"])
        index("MantleRequest", "requestId", ["RV-R1"])
        index("MantleOrder", "orderId", ["RV-O1", "RV-O2"])
        index("MantleWikiPage", "wikiPageId", ["RV_WP1", "RV_WP2", "RV_WP3"])
        const ids = ["RV-T1", "RV-T2", "RV-R1", "RV-O1", "RV-O2", "RV_WP1", "RV_WP2", "RV_WP3"]
        const search = () => call(SEARCH, { q: "Visibility", entityType: "MantleTask,MantleRequest,MantleOrder,MantleWikiPage", limit: 100,
            highlight: false }).results.map((result) => result.id).filter((id) => ids.includes(id)).sort()
        const beaSees = () => sees({ O1: [ORDER, "RV-O1"], O2: [ORDER, "RV-O2"], R1: [REQUEST, "RV-R1"], T2: [WORK, "RV-T2"] })
        return { ace: as("rv.ace", search), axel: as("rv.axel", search), bea: as("rv.bea", search), beaSees: as("rv.bea", beaSees),
            mo: as("rv.mo", search), pat: as("rv.pat", search), oz: as("rv.oz", search), opal: as("rv.opal", search),
            searchAvailable: ec.search.isAvailable() }
    },
    then({ ace, axel, bea, beaSees, mo, pat, oz, opal, searchAvailable }) {
        searchAvailable
        // the active organization filter with no active organization: RV_ORG's task, request and order, the open page
        ace == ["RV-O1", "RV-R1", "RV-T1", "RV_WP1"]
        axel == ["RV_WP1"]
        // the same beside the personal contact filter, in the search and in the record check
        bea == ["RV-O1", "RV-R1", "RV-T1", "RV_WP1"]
        beaSees == { O1: true, O2: false, R1: true, T2: false }
        // the user organization filter: Mo a member of the restricted space, Pat the viewer of the restricted page
        mo == ["RV-O1", "RV-R1", "RV-T1", "RV_WP1", "RV_WP2"]
        pat == ["RV-R1", "RV-T1", "RV_WP1", "RV_WP3"]
        // Oz administers the restricted space
        oz == ["RV_WP1", "RV_WP2"]
        // no organization filter: every task, request and order, and the wiki's rule still
        opal == ["RV-O1", "RV-O2", "RV-R1", "RV-T1", "RV-T2", "RV_WP1"]
    },
})
