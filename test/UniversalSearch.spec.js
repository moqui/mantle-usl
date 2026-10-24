// The universal search's per-user limits (mantle.search.UniversalSearchServices.search#Universal) and lookup by id of a
// request and a communication event (mantle.GeneralServices.lookup#ById). Two employees of ORG_ZIZI_RETAIL search
// with the user organization filter that every IronStone app's authz carries. New spec, no Groovy original.
const effectiveTime = Date.now()
const dayMillis = 86400000
const word = "Zyxwvut"
const searchTypes = "MantleProject,MantleTask,MantleEvent,MantleRequest,MantleCommunicationEvent"
const records = ["MantleTask:USS-T1", "MantleTask:USS-T2", "MantleTask:USS-T3", "MantleTask:USS-T4", "MantleEvent:USS-E1",
    "MantleProject:USSP1", "MantleRequest:USS-R1", "MantleCommunicationEvent:USS-C1", "MantleCommunicationEvent:USS-C2"]
let partyAId, partyBId

spec({
    stepwise: true,
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(effectiveTime)
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

// index the records now rather than wait for the data feed's worker
function indexRecords(documentId, keyField, ids) {
    for (const id of ids) ec.search.indexDocuments(ec.entity.getDataDocuments(documentId, { [keyField]: id }))
}

// search as a user with authz on, as a screen would: its organizations in the user context, then the search; the
// results are "type:id" for the records of this spec
function searchAs(username) {
    login(username, "moqui1!!")
    call("mantle.party.PartyServices.setup#UserOrganizationInfo", {})
    const orgIds = ec.user.context.filterOrgIds
    ec.artifactExecution.enableAuthz()
    try {
        const out = call("mantle.search.UniversalSearchServices.search#Universal", { q: word, entityType: searchTypes, limit: 50, highlight: false })
        return { orgIds, found: out.results.map((result) => `${result.entityType}:${result.id}`).filter((key) => records.includes(key)).sort() }
    } finally {
        ec.artifactExecution.disableAuthz()
        for (const name of ["userOrgIds", "filterOrgIds", "activeOrgId"]) delete ec.user.context[name]
        login("john.doe")
    }
}

feature("two employees of an organization whose search authz carries the user organization filter", {
    when() {
        const searchAvailable = ec.search.isAvailable()
        call("create#moqui.security.UserGroup", { userGroupId: "USS_SEARCH", description: "Universal search scope test" })
        call("create#moqui.security.ArtifactGroup", { artifactGroupId: "USS_SEARCH", description: "Universal search" })
        call("create#moqui.security.ArtifactGroupMember", { artifactGroupId: "USS_SEARCH", artifactTypeEnumId: "AT_SERVICE",
                artifactName: "mantle.search.UniversalSearchServices.search#Universal", nameIsPattern: "N", inheritAuthz: "Y" })
        call("create#moqui.security.ArtifactAuthz", { artifactAuthzId: "USS_SEARCH", userGroupId: "USS_SEARCH", artifactGroupId: "USS_SEARCH",
                authzTypeEnumId: "AUTHZT_ALLOW", authzActionEnumId: "AUTHZA_ALL" })
        call("create#moqui.security.ArtifactAuthzFilter", { artifactAuthzId: "USS_SEARCH", entityFilterSetId: "MANTLE_USER_ORG" })
        const userIds = []
        for (const [first, username] of [["Avery", "uss.avery"], ["Blake", "uss.blake"]]) {
            const partyId = call("mantle.party.PartyServices.create#Person", { firstName: first, lastName: "Searchscope" }).partyId
            userIds.push(call("mantle.party.PartyServices.create#PartyUserAccount", { partyId, emailAddress: `${username}@example.com`, username,
                    newPassword: "moqui1!!", newPasswordVerify: "moqui1!!" }).userId)
            call("create#mantle.party.PartyRelationship", { relationshipTypeEnumId: "PrtEmployee", fromPartyId: partyId, fromRoleTypeId: "Employee",
                    toPartyId: "ORG_ZIZI_RETAIL", toRoleTypeId: "OrgInternal", fromDate: effectiveTime - dayMillis })
            call("create#moqui.security.UserGroupMember", { userGroupId: "USS_SEARCH", userId: userIds[userIds.length - 1], fromDate: effectiveTime - dayMillis })
            if (first === "Avery") partyAId = partyId
            else partyBId = partyId
        }
        const orgInfo = call("mantle.party.PartyServices.get#PartyOrganizationInfo", { partyId: partyAId })
        return { searchAvailable, userIds, orgInfo }
    },
    then({ searchAvailable, userIds, orgInfo }) {
        searchAvailable
        userIds.length == 2
        partyAId != null
        partyBId != null
        orgInfo.filterOrgIds.includes("ORG_ZIZI_RETAIL")
    },
})

feature("tasks, an event, a project, a request and messages, some naming the first employee, indexed", {
    when() {
        // the first employee is assigned to USS-T1, and was assigned to USS-T2 until yesterday; USS-T3 is the organization's
        // and USS-T4 its parent's, which the employees are not part of; the creator, john.doe, owns USS-T1 and USS-T2
        call("mantle.work.TaskServices.create#Task", { workEffortId: "USS-T1", workEffortName: `${word} assigned task`, assignToPartyId: partyAId })
        call("mantle.work.TaskServices.create#Task", { workEffortId: "USS-T2", workEffortName: `${word} unassigned task` })
        call("create#mantle.work.effort.WorkEffortParty", { workEffortId: "USS-T2", partyId: partyAId, roleTypeId: "Assignee",
                fromDate: effectiveTime - 3 * dayMillis, thruDate: effectiveTime - dayMillis, statusId: "WeptAssigned" })
        call("mantle.work.TaskServices.create#Task", { workEffortId: "USS-T3", workEffortName: `${word} organization task`, ownerPartyId: "ORG_ZIZI_RETAIL" })
        call("mantle.work.TaskServices.create#Task", { workEffortId: "USS-T4", workEffortName: `${word} parent organization task`, ownerPartyId: "ORG_ZIZI_CORP" })
        // an event the first employee owns, and a project the organization is the vendor of
        call("create#mantle.work.effort.WorkEffort", { workEffortId: "USS-E1", workEffortTypeEnumId: "WetEvent", workEffortName: `${word} planning event`,
                statusId: "WeInPlanning", ownerPartyId: partyAId, estimatedStartDate: effectiveTime + dayMillis })
        call("mantle.work.ProjectServices.create#Project", { workEffortId: "USSP1", workEffortName: `${word} project`, vendorPartyId: "ORG_ZIZI_RETAIL" })
        // a request the first employee reported
        call("create#mantle.request.Request", { requestId: "USS-R1", requestName: `${word} access request`, requestTypeEnumId: "RqtSupport",
                statusId: "ReqSubmitted", requestDate: effectiveTime })
        call("create#mantle.request.RequestParty", { requestId: "USS-R1", partyId: partyAId, roleTypeId: "Reporter", fromDate: effectiveTime })
        // a message to the first employee, and one the second employee watches
        call("create#mantle.party.communication.CommunicationEvent", { communicationEventId: "USS-C1", communicationEventTypeId: "Message",
                statusId: "CeSent", fromPartyId: "EX_JOHN_DOE", toPartyId: partyAId, subject: `${word} hello`, body: "To the first employee", entryDate: effectiveTime })
        call("create#mantle.party.communication.CommunicationEvent", { communicationEventId: "USS-C2", communicationEventTypeId: "Message",
                statusId: "CeSent", fromPartyId: "EX_JOHN_DOE", toPartyId: "ORG_ZIZI_CORP", subject: `${word} update`, body: "To the parent", entryDate: effectiveTime })
        call("create#mantle.party.communication.CommunicationEventParty", { communicationEventId: "USS-C2", partyId: partyBId, roleTypeId: "Watcher" })

        indexRecords("MantleTask", "workEffortId", ["USS-T1", "USS-T2", "USS-T3", "USS-T4"])
        indexRecords("MantleEvent", "workEffortId", ["USS-E1"])
        indexRecords("MantleProject", "workEffortId", ["USSP1"])
        indexRecords("MantleRequest", "requestId", ["USS-R1"])
        indexRecords("MantleCommunicationEvent", "communicationEventId", ["USS-C1", "USS-C2"])
        const expired = ec.search.getDocument("MantleTask", "USS-T2")
        const request = ec.search.getDocument("MantleRequest", "USS-R1")
        return { expired, request }
    },
    then({ expired, request }) {
        expired.parties.length == 1
        expired.parties[0].partyId == partyAId
        expired.parties[0].partyThruDate != null
        request.parties[0].partyId == partyAId
        request.parties[0].partyThruDate == null
    },
})

// USS-T2 shows too: any party row counts until the search can compare partyThruDate (the TODO in search#Universal)
feature("with the organization filter on, the first employee finds what names them and the organization's records", {
    when() { return searchAs("uss.avery") },
    then({ orgIds, found }) {
        orgIds.includes("ORG_ZIZI_RETAIL")
        found == ["MantleCommunicationEvent:USS-C1", "MantleEvent:USS-E1", "MantleProject:USSP1", "MantleRequest:USS-R1",
            "MantleTask:USS-T1", "MantleTask:USS-T2", "MantleTask:USS-T3"]
    },
})

feature("the second employee finds only the organization's records and the message they are a party to", {
    when() { return searchAs("uss.blake") },
    then({ orgIds, found }) {
        orgIds.includes("ORG_ZIZI_RETAIL")
        found == ["MantleCommunicationEvent:USS-C2", "MantleProject:USSP1", "MantleTask:USS-T3"]
    },
})

feature("without an organization filter every type is searched as before", {
    when() {
        const out = call("mantle.search.UniversalSearchServices.search#Universal", { q: word, entityType: searchTypes, limit: 50, highlight: false })
        return { found: out.results.map((result) => `${result.entityType}:${result.id}`).filter((key) => records.includes(key)).sort() }
    },
    then({ found }) {
        found == records.slice().sort()
    },
})

feature("a task result has its name as the title, its id as the code and the IronStone TaskDetail link", {
    when() {
        const out = call("mantle.search.UniversalSearchServices.search#Universal", { q: word, entityType: "MantleTask,MantleRequest", limit: 50, highlight: false })
        const task = out.results.find((result) => result.entityType === "MantleTask" && result.id === "USS-T1")
        const request = out.results.find((result) => result.entityType === "MantleRequest" && result.id === "USS-R1")
        return { task, request }
    },
    then({ task, request }) {
        task != null
        task.title == `${word} assigned task`
        task.code == "USS-T1"
        task.url == "/apps/Commons/Tasks/TaskDetail?workEffortId=USS-T1"
        task.linkLabel == "Task"
        request.title == `${word} access request`
        request.url == "/apps/Commons/Requests/RequestDetail?requestId=USS-R1"
    },
})

feature("lookup by id finds a request and a communication event", {
    when() {
        const request = call("mantle.GeneralServices.lookup#ById", { lookupId: "USS-R1" })
        const message = call("mantle.GeneralServices.lookup#ById", { lookupId: "USS-C1" })
        const unknown = call("mantle.GeneralServices.lookup#ById", { lookupId: "NO-SUCH-ID-ANYWHERE" })
        return { request, message, unknown }
    },
    then({ request, message, unknown }) {
        request.requestId == "USS-R1"
        request.request.requestName == `${word} access request`
        request.communicationEventId == null
        message.communicationEventId == "USS-C1"
        message.communicationEvent.toPartyId == partyAId
        message.requestId == null
        unknown.requestId == null
        unknown.communicationEventId == null
    },
})
