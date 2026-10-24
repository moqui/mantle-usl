// Client access in the project services (design-projects.md §1.1, §15 Client access and Chatter for client users;
// impl-projects.md P10a): a user with the PROJECT_CLIENT permission is a client contact, who sees only the projects that allow
// client sign-in (WstClientSignIn Y) on which its party or an organization it is a contact, employee or representative of holds
// a client role (mantle.work.ProjectServices get#ClientProjectInfo, get#VisibleProjectInfo), their items shared with the client,
// milestones and releases, its organization's requests, the messages for it and the status updates posted for it
// (mantle.party.CommunicationServices get#ClientRecordVisibility, get#RecordLinkInfo, get#RecordTimeline), and is told only of
// those (filter#ClientAudience in the follower and mention notices); it views only the repositories of its projects that share
// them (mantle.work.GitServices.check#GitRepositoryAuthz). Also the allocation request notice reaches only the approvers who see
// the project (impl-projects.md F85), and the sprint numbers only those who see the project and are no client (F111).
// New spec, no Groovy original.
const effectiveTime = Date.now()
const dayMillis = 86400000
const PROJECT = "mantle.work.ProjectServices"
const COMM = "mantle.party.CommunicationServices"
const WORK = "mantle.work.effort.WorkEffort"
const REQUEST = "mantle.request.Request"
const EVENT = "mantle.party.communication.CommunicationEvent"
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

// as the user, with authorization on as a screen would have it (the services authorized by the CL_SERVICES group)
function as(username, run) {
    login(username, username === "john.doe" ? "moqui" : "moqui1!!")
    ec.artifactExecution.enableAuthz()
    try { return run() } finally {
        ec.artifactExecution.disableAuthz()
        login("john.doe")
    }
}
// as the user, authorization off (the services that do not depend on it)
function asOff(username, run) {
    login(username, username === "john.doe" ? "moqui" : "moqui1!!")
    try { return run() } finally { login("john.doe") }
}
function sees(map) {
    const out = {}
    for (const [name, [recordEntityName, recordId]] of Object.entries(map)) {
        const result = ec.service.sync().name(`${COMM}.get#RecordLinkInfo`).parameters({ recordEntityName, recordId, checkOnly: true }).call()
        if (ec.message.hasError()) { out[name] = `error: ${ec.message.getErrorsString()}`; ec.message.clearErrors(); continue }
        out[name] = result.recordVisible === true
    }
    return out
}
const message = (fromPartyId, toPartyId, type, subject, link) => {
    const id = call("create#mantle.party.communication.CommunicationEvent", { communicationEventTypeId: type, statusId: "CeSent", fromPartyId,
        toPartyId, entryDate: ec.user.nowTimestamp, subject, body: subject, contentType: "text/plain" }).communicationEventId
    if (link[0] === WORK) call("create#mantle.work.effort.WorkEffortCommEvent", { workEffortId: link[1], communicationEventId: id })
    else call("create#mantle.request.RequestCommEvent", { requestId: link[1], communicationEventId: id })
    return id
}

feature("two client organizations with their contacts, three client projects (one without client sign-in), items, requests and messages", {
    when() {
        const past = effectiveTime - dayMillis
        for (const [orgId, name] of [["CL_ORG1", "Client One"], ["CL_ORG2", "Client Two"]]) {
            call("create#mantle.party.Party", { partyId: orgId, partyTypeEnumId: "PtyOrganization", ownerPartyId: "_NA_" })
            call("create#mantle.party.Organization", { partyId: orgId, organizationName: name })
            call("create#mantle.party.PartyRole", { partyId: orgId, roleTypeId: "Customer" })
        }
        // the services a client's screens call, authorized for the client group and the internal one alike
        call("create#moqui.security.ArtifactGroup", { artifactGroupId: "CL_SERVICES", description: "Client access services" })
        for (const artifactName of [`${COMM}.get#RecordLinkInfo`, `${COMM}.get#RecordTimeline`, `${COMM}.get#ClientRecordVisibility`,
                "mantle.work.ProjectReportServices.get#SprintVelocity", "mantle.work.ProjectReportServices.get#SprintBurndown"])
            call("create#moqui.security.ArtifactGroupMember", { artifactGroupId: "CL_SERVICES", artifactTypeEnumId: "AT_SERVICE", artifactName,
                nameIsPattern: "N", inheritAuthz: "Y" })
        for (const groupId of ["CL_CLIENT", "CL_TEAM", "CL_APPROVERS"]) {
            call("create#moqui.security.UserGroup", { userGroupId: groupId, description: `Client access ${groupId}` })
            call("create#moqui.security.ArtifactAuthz", { artifactAuthzId: groupId, userGroupId: groupId, artifactGroupId: "CL_SERVICES",
                authzTypeEnumId: "AUTHZT_ALLOW", authzActionEnumId: "AUTHZA_ALL" })
        }
        call("create#moqui.security.UserGroupPermission", { userGroupId: "CL_CLIENT", userPermissionId: "PROJECT_CLIENT", fromDate: past })
        call("create#moqui.security.UserGroupMember", { userGroupId: "CL_TEAM", userId: "EX_JOHN_DOE", fromDate: past })
        call("create#moqui.security.UserGroupPermission", { userGroupId: "CL_APPROVERS", userPermissionId: "ALLOCATION_APPROVE", fromDate: past })
        // Cleo of CL_ORG1 and Dex of CL_ORG2 sign in as clients (Dex also an allocation approver, which a client never is told as);
        // Cole is Cleo's colleague with no user; Amy works on CLP1 and Otto on nothing, both approvers
        for (const [first, username, groups, orgId, relationship] of [["Cleo", "cl.cleo", ["CL_CLIENT"], "CL_ORG1", "PrtContact"],
            ["Cole", null, [], "CL_ORG1", "PrtEmployee"], ["Dex", "cl.dex", ["CL_CLIENT", "CL_APPROVERS"], "CL_ORG2", "PrtRepresentative"],
            ["Amy", "cl.amy", ["CL_TEAM", "CL_APPROVERS"], null, null], ["Otto", "cl.otto", ["CL_TEAM", "CL_APPROVERS"], null, null]]) {
            const partyId = call("mantle.party.PartyServices.create#Person", { firstName: first, lastName: "Client" }).partyId
            parties[first] = partyId
            if (username) {
                users[first] = call("mantle.party.PartyServices.create#PartyUserAccount", { partyId, emailAddress: `${username}@example.com`, username,
                    newPassword: "moqui1!!", newPasswordVerify: "moqui1!!" }).userId
                for (const userGroupId of groups) call("create#moqui.security.UserGroupMember", { userGroupId, userId: users[first], fromDate: past })
            }
            if (orgId) call("create#mantle.party.PartyRelationship", { relationshipTypeEnumId: relationship, fromPartyId: partyId,
                toPartyId: orgId, fromDate: past })
        }
        // CLP1 of CL_ORG1 (client sign-in), CLP2 of CL_ORG2 (client sign-in), CLP3 of CL_ORG1 (no client sign-in)
        for (const [projectId, orgId, signIn] of [["CLP1", "CL_ORG1", "Y"], ["CLP2", "CL_ORG2", "Y"], ["CLP3", "CL_ORG1", null]]) {
            call(`${PROJECT}.create#Project`, { workEffortId: projectId, workEffortName: `Client project ${projectId}`, visibilityEnumId: "WevWorkGroup" })
            call("create#mantle.work.effort.WorkEffortParty", { workEffortId: projectId, partyId: orgId, roleTypeId: "Customer", fromDate: past })
            call("create#mantle.work.effort.WorkEffortParty", { workEffortId: projectId, partyId: "EX_JOHN_DOE", roleTypeId: "ProjectManager", fromDate: past })
            if (signIn) call(`${PROJECT}.store#ProjectSetting`, { workEffortId: projectId, settingTypeEnumId: "WstClientSignIn", settingValue: signIn })
        }
        call("create#mantle.work.effort.WorkEffortParty", { workEffortId: "CLP1", partyId: parties.Amy, roleTypeId: "Programmer", fromDate: past })
        // Cleo's own party also holds a role: an internal-sounding one, which gives a client nothing more
        call("create#mantle.work.effort.WorkEffortParty", { workEffortId: "CLP1", partyId: parties.Cleo, roleTypeId: "Watcher", fromDate: past })
        for (const [id, root, name, visibilityEnumId, type] of [["CLP1-1", "CLP1", "Shared item", "WevGeneral", "WetTask"],
            ["CLP1-2", "CLP1", "Team item", "WevWorkGroup", "WetTask"], ["CLP1-3", "CLP1", "Unset item", null, "WetTask"],
            ["CLP1-MS", "CLP1", "Sign-off", null, "WetMilestone"], ["CLP1-SP", "CLP1", "Sprint 1", null, "WetSprint"],
            ["CLP2-1", "CLP2", "Other client's item", "WevGeneral", "WetTask"], ["CLP3-1", "CLP3", "No sign-in item", "WevGeneral", "WetTask"]])
            call("create#mantle.work.effort.WorkEffort", { workEffortId: id, rootWorkEffortId: root, parentWorkEffortId: type === "WetTask" ? null : null,
                workEffortTypeEnumId: type, workEffortName: name, visibilityEnumId, statusId: type === "WetSprint" ? "WeComplete" : "WeInProgress",
                estimatedWorkTime: 8, remainingWorkTime: 4, actualStartDate: past, actualCompletionDate: type === "WetSprint" ? ec.user.nowTimestamp : null })
        // requests: one Cole filed, one John filed for CL_ORG1, one Dex filed on CLP2
        for (const [requestId, root, filedBy, orgParty] of [["CLR1", "CLP1", parties.Cole, null], ["CLR2", "CLP1", "EX_JOHN_DOE", "CL_ORG1"],
            ["CLR3", "CLP2", parties.Dex, null]]) {
            call("create#mantle.request.Request", { requestId, rootWorkEffortId: root, requestName: `Request ${requestId}`, requestTypeEnumId: "RqtSupport",
                statusId: "ReqSubmitted", requestDate: ec.user.nowTimestamp, filedByPartyId: filedBy })
            if (orgParty) call("create#mantle.request.RequestParty", { requestId, partyId: orgParty, roleTypeId: "Customer", fromDate: past })
        }
        // messages and notes
        events.note = message("EX_JOHN_DOE", null, "Comment", "Internal note", [WORK, "CLP1-1"])
        events.toCleo = message("EX_JOHN_DOE", parties.Cleo, "Message", "To Cleo", [WORK, "CLP1-1"])
        events.toCole = message("EX_JOHN_DOE", parties.Cole, "Message", "To Cole", [REQUEST, "CLR1"])
        events.ccCleo = message("EX_JOHN_DOE", parties.Amy, "Message", "Cc Cleo", [WORK, "CLP1-1"])
        call("create#mantle.party.communication.CommunicationEventParty", { communicationEventId: events.ccCleo, partyId: parties.Cleo, roleTypeId: "MessageCc" })
        events.internal = message("EX_JOHN_DOE", parties.Amy, "Message", "Team only", [WORK, "CLP1-1"])
        events.toDex = message("EX_JOHN_DOE", parties.Dex, "Message", "To Dex", [WORK, "CLP2-1"])
        events.coleElsewhere = message("EX_JOHN_DOE", parties.Cole, "Message", "Cole on another client's item", [WORK, "CLP2-1"])
        for (const [name, visible] of [["update", "Y"], ["teamUpdate", "N"]]) {
            events[name] = message("EX_JOHN_DOE", null, "StatusUpdate", `Status ${visible}`, [WORK, "CLP1"])
            call("create#mantle.work.effort.WorkEffortUpdate", { workEffortId: "CLP1", communicationEventId: events[name], updateDate: ec.user.nowTimestamp,
                healthEnumId: "WehOnTrack", clientVisible: visible })
        }
        // a repository linked to CLP1 (its record only: the rights are decided by the project's roles and settings)
        call("create#moqui.resource.GitRepository", { repositoryId: "CL_REPO", description: "Client access repository", repositoryKind: "db" })
        call("create#mantle.work.effort.WorkEffortGitRepository", { workEffortId: "CLP1", repositoryId: "CL_REPO", fromDate: past })
        return { cleo: users.Cleo, dex: users.Dex }
    },
    then({ cleo, dex }) {
        cleo != null
        dex != null
    },
})

feature("a client's projects: client sign-in on and a client role of its party or organization; its organization's contacts; nobody else is a client", {
    when() {
        const info = (username) => asOff(username, () => call(`${PROJECT}.get#ClientProjectInfo`, {}))
        return { cleo: info("cl.cleo"), dex: info("cl.dex"), amy: info("cl.amy"), john: info("john.doe"),
            byId: call(`${PROJECT}.get#ClientProjectInfo`, { userId: users.Cleo }) }
    },
    then({ cleo, dex, amy, john, byId }) {
        cleo.isClient == true
        cleo.clientProjectIds == ["CLP1"]
        cleo.clientOrgIds == ["CL_ORG1"]
        cleo.clientContactPartyIds.includes(parties.Cole)
        !cleo.clientContactPartyIds.includes(parties.Dex)
        cleo.statusUpdateIds == [events.update]
        cleo.scopePartyIds.includes(parties.Amy)
        !cleo.scopePartyIds.includes(parties.Dex)
        !cleo.scopePartyIds.includes("CL_ORG2")
        dex.clientProjectIds == ["CLP2"]
        amy.isClient == false
        amy.clientProjectIds == []
        john.isClient == false
        byId.clientProjectIds == ["CLP1"]
    },
})

feature("get#VisibleProjectInfo: a client sees its client projects only, is a member or manager of none; the team is as before", {
    when() {
        const vis = (username) => asOff(username, () => call(`${PROJECT}.get#VisibleProjectInfo`, {}))
        const cleo = vis("cl.cleo")
        const amy = vis("cl.amy")
        return { cleo, amy }
    },
    then({ cleo, amy }) {
        cleo.isClient == true
        cleo.visibleProjectIds == ["CLP1"]
        cleo.memberProjectIds == []
        cleo.managedProjectIds == []
        cleo.itemVisibilityIds == ["WevAllUsers", "WevGeneral"]
        amy.isClient == false
        amy.itemVisibilityIds == null
        amy.memberProjectIds.includes("CLP1")
    },
})

feature("get#RecordLinkInfo for a client: its project, shared items, milestones, its organization's requests, the messages for it", {
    when() {
        const map = { CLP1: [WORK, "CLP1"], shared: [WORK, "CLP1-1"], team: [WORK, "CLP1-2"], unset: [WORK, "CLP1-3"], milestone: [WORK, "CLP1-MS"],
            sprint: [WORK, "CLP1-SP"], CLP2: [WORK, "CLP2"], other: [WORK, "CLP2-1"], CLP3: [WORK, "CLP3"], noSignIn: [WORK, "CLP3-1"],
            colleague: [REQUEST, "CLR1"], forOrg: [REQUEST, "CLR2"], otherRequest: [REQUEST, "CLR3"], note: [EVENT, events.note],
            toCleo: [EVENT, events.toCleo], toCole: [EVENT, events.toCole], ccCleo: [EVENT, events.ccCleo], internal: [EVENT, events.internal],
            toDex: [EVENT, events.toDex], coleElsewhere: [EVENT, events.coleElsewhere], update: [EVENT, events.update], teamUpdate: [EVENT, events.teamUpdate],
            org: ["mantle.party.Party", "CL_ORG1"], self: ["mantle.party.Party", parties.Cleo] }
        return { cleo: as("cl.cleo", () => sees(map)), dex: as("cl.dex", () => sees({ CLP1: [WORK, "CLP1"], other: [WORK, "CLP2-1"], toDex: [EVENT, events.toDex] })) }
    },
    then({ cleo, dex }) {
        cleo == { CLP1: true, shared: true, team: false, unset: false, milestone: true, sprint: false, CLP2: false, other: false, CLP3: false, noSignIn: false,
            colleague: true, forOrg: true, otherRequest: false, note: false, toCleo: true, toCole: true, ccCleo: true, internal: false, toDex: false,
            coleElsewhere: false, update: true, teamUpdate: false, org: false, self: false }
        dex == { CLP1: false, other: true, toDex: true }
    },
})

feature("get#RecordTimeline for a client: the messages for it and status changes, no notes, activities, files or time", {
    when() {
        const timeline = (kinds) => as("cl.cleo", () => {
            const out = ec.service.sync().name(`${COMM}.get#RecordTimeline`).parameters({ recordEntityName: WORK, recordId: "CLP1-1", kinds }).call()
            const errors = ec.message.hasError() ? ec.message.getErrorsString() : ""
            ec.message.clearErrors()
            return { errors, ids: Array.from(out?.entryList || []).filter((entry) => entry.communicationEventId).map((entry) => entry.communicationEventId).sort(),
                kinds: Array.from(new Set(Array.from(out?.entryList || []).map((entry) => entry.kind))).sort() }
        })
        const john = as("john.doe", () => Array.from(ec.service.sync().name(`${COMM}.get#RecordTimeline`).parameters({ recordEntityName: WORK, recordId: "CLP1-1" })
                .call()?.entryList || []).filter((entry) => entry.communicationEventId).map((entry) => entry.communicationEventId).sort())
        const project = as("cl.cleo", () => Array.from(ec.service.sync().name(`${COMM}.get#RecordTimeline`).parameters({ recordEntityName: WORK, recordId: "CLP1" })
                .call()?.entryList || []).filter((entry) => entry.communicationEventId).map((entry) => entry.communicationEventId))
        return { all: timeline(null), notes: timeline("notes"), john, project }
    },
    then({ all, notes, john, project }) {
        all.errors == ""
        all.ids == [events.ccCleo, events.toCleo].sort()
        all.kinds.every((kind) => kind === "message" || kind === "change")
        notes.ids == []
        john.includes(events.note)
        john.includes(events.internal)
        project == [events.update]
    },
})

feature("notices: a client is told only of a message for it, never of a note or another's message", {
    when() {
        const audience = (communicationEventId) => call(`${COMM}.filter#ClientAudience`, { userIds: [users.Cleo, users.Dex, users.Amy],
            communicationEventId }).userIds
        return { note: audience(events.note), toCleo: audience(events.toCleo), none: audience(null) }
    },
    then({ note, toCleo, none }) {
        note == [users.Amy]
        toCleo == [users.Cleo, users.Amy]
        none == [users.Amy]
    },
})

feature("repositories: a client views only those of its projects that share them, never pushes, whatever role its own party holds", {
    when() {
        const authz = (userId, action) => call("mantle.work.GitServices.check#GitRepositoryAuthz", { userId, authzActionEnumId: action,
            artifactTypeEnumId: "AT_GIT_REPOSITORY", artifactName: "CL_REPO" }).authzTypeEnumId
        const before = { cleoView: authz(users.Cleo, "AUTHZA_VIEW"), dexView: authz(users.Dex, "AUTHZA_VIEW"), amyUpdate: authz(users.Amy, "AUTHZA_UPDATE") }
        call(`${PROJECT}.store#ProjectSetting`, { workEffortId: "CLP1", settingTypeEnumId: "WstShareRepositories", settingValue: "Y" })
        const after = { cleoView: authz(users.Cleo, "AUTHZA_VIEW"), cleoUpdate: authz(users.Cleo, "AUTHZA_UPDATE"), dexView: authz(users.Dex, "AUTHZA_VIEW") }
        return { before, after }
    },
    then({ before, after }) {
        before == { cleoView: "AUTHZT_NONE", dexView: "AUTHZT_NONE", amyUpdate: "AUTHZT_ALLOW" }
        after == { cleoView: "AUTHZT_ALLOW", cleoUpdate: "AUTHZT_NONE", dexView: "AUTHZT_NONE" }
    },
})

feature("an allocation request is told to the approvers who see the project only, never a client (F85)", {
    when() {
        const allocationId = call("create#mantle.work.effort.WorkEffortAllocation", { rootWorkEffortId: "CLP1", roleTypeId: "Programmer",
            fromDate: "2030-03-04", thruDate: "2030-03-29", hoursPerWeek: 10, statusId: "WealRequested" }).workEffortAllocationId
        const told = call("mantle.work.ResourceServices.notify#Allocation", { workEffortAllocationId: allocationId, change: "requested" }).userIdList
        return { allocationId, told: Array.from(told || []) }
    },
    then({ told }) {
        told.includes(users.Amy)
        !told.includes(users.Otto)
        !told.includes(users.Dex)
    },
    // the request is only for its notice: left open it is one more for the approvers of the specs after this one
    cleanup({ allocationId }) {
        if (allocationId) call("delete#mantle.work.effort.WorkEffortAllocation", { workEffortAllocationId: allocationId })
    },
})

feature("the sprint numbers are for those who see the project and are no client (F111)", {
    when() {
        const velocity = (username) => as(username, () => {
            const out = ec.service.sync().name("mantle.work.ProjectReportServices.get#SprintVelocity").parameters({ rootWorkEffortId: "CLP1" }).call()
            ec.message.clearErrors()
            return Array.from(out?.sprintList || []).length
        })
        const burndown = (username) => as(username, () => {
            ec.service.sync().name("mantle.work.ProjectReportServices.get#SprintBurndown").parameters({ workEffortId: "CLP1-SP", withDays: false }).call()
            const errors = ec.message.hasError() ? ec.message.getErrorsString() : ""
            ec.message.clearErrors()
            return errors
        })
        return { amy: velocity("cl.amy"), otto: velocity("cl.otto"), cleo: velocity("cl.cleo"), amyBurndown: burndown("cl.amy"), cleoBurndown: burndown("cl.cleo") }
    },
    then({ amy, otto, cleo, amyBurndown, cleoBurndown }) {
        amy == 1
        otto == 0
        cleo == 0
        amyBurndown == ""
        cleoBurndown.includes("not found")
    },
})

// impl-projects.md P10b, F101: the client is told by email (it has no tray): a status update posted for it, and the estimate sent
// for its approval, each to the client contacts (people with a client role on the project and an email address) on their own
const emailIds = (templateId) => new Set(Array.from(ec.entity.find("moqui.basic.email.EmailMessage").condition("emailTemplateId", templateId).list())
        .map((email) => email.emailMessageId))
const emailsTo = (templateId, before) => Array.from(ec.entity.find("moqui.basic.email.EmailMessage").condition("emailTemplateId", templateId).list())
        .filter((email) => !before.has(email.emailMessageId)).map((email) => ({ to: String(email.toAddresses || ""), subject: String(email.subject || ""),
        body: String(email.body || "") }))

feature("a status update posted for the client is emailed to its contacts on a project with client sign-in, and to nobody else", {
    when() {
        const past = effectiveTime - dayMillis
        // Cleo manages CLP1 and CLP3 for her organization, Cole (no address) bills CLP1, Dex manages CLP2
        for (const [projectId, party, roleTypeId] of [["CLP1", parties.Cleo, "ClientManager"], ["CLP1", parties.Cole, "ClientBilling"],
                ["CLP2", parties.Dex, "ClientManager"], ["CLP3", parties.Cleo, "ClientManager"]])
            call("create#mantle.work.effort.WorkEffortParty", { workEffortId: projectId, partyId: party, roleTypeId, fromDate: past })
        const since = emailIds("MANTLE_PROJECT_UPDATE")
        const contacts = call(`${PROJECT}.get#ProjectClientContacts`, { workEffortId: "CLP1", senderPartyId: "EX_JOHN_DOE" })
        call(`${PROJECT}.post#ProjectUpdate`, { workEffortId: "CLP1", healthEnumId: "WehAtRisk", percentComplete: 40, subject: "ZQX for the client",
            body: "The sign-in waits for your test accounts.", clientVisible: "Y" })
        const shared = emailsTo("MANTLE_PROJECT_UPDATE", since)
        const since2 = emailIds("MANTLE_PROJECT_UPDATE")
        call(`${PROJECT}.post#ProjectUpdate`, { workEffortId: "CLP1", healthEnumId: "WehOnTrack", subject: "Team only update", body: "Margins are thin.", clientVisible: "N" })
        call(`${PROJECT}.post#ProjectUpdate`, { workEffortId: "CLP3", healthEnumId: "WehOnTrack", subject: "No sign-in update", body: "Nothing to see.", clientVisible: "Y" })
        const others = emailsTo("MANTLE_PROJECT_UPDATE", since2)
        return { contacts, shared, others }
    },
    then({ contacts, shared, others }) {
        contacts.clientSignIn == true
        contacts.contactList.map((contact) => contact.partyId) == [parties.Cleo]
        contacts.skippedList.map((skip) => skip.partyId).includes(parties.Cole)
        shared.length == 1
        shared[0].to == "cl.cleo@example.com"
        shared[0].subject.includes("ZQX for the client")
        shared[0].body.includes("The sign-in waits for your test accounts.")
        others.filter((email) => email.to.includes("cl.dex") || email.to.includes("cl.cleo")) == []
    },
})

feature("the estimate sent for approval is emailed to the client approver with the estimate, and not when the approver is an organization", {
    when() {
        // CLP4: CL_ORG2's, with no client manager: its estimate goes to the organization, which has no address of a person
        call(`${PROJECT}.create#Project`, { workEffortId: "CLP4", workEffortName: "Client project CLP4", visibilityEnumId: "WevWorkGroup" })
        call("create#mantle.work.effort.WorkEffortParty", { workEffortId: "CLP4", partyId: "CL_ORG2", roleTypeId: "Customer", fromDate: effectiveTime - dayMillis })
        call("create#mantle.work.effort.WorkEffortParty", { workEffortId: "CLP4", partyId: "EX_JOHN_DOE", roleTypeId: "ProjectManager", fromDate: effectiveTime - dayMillis })
        const since = emailIds("MANTLE_PROJECT_ESTIMATE")
        const sent = call(`${PROJECT}.send#EstimateForApproval`, { workEffortId: "CLP1", depth: 2, comments: "Our estimate, for your approval" })
        const toOrg = call(`${PROJECT}.send#EstimateForApproval`, { workEffortId: "CLP4", depth: 2 })
        const emails = emailsTo("MANTLE_PROJECT_ESTIMATE", since)
        return { sent, toOrg, emails }
    },
    then({ sent, toOrg, emails }) {
        sent.workEffortApprovalId != null
        sent.emailedAddressList == ["cl.cleo@example.com"]
        emails.length == 1
        emails[0].to == "cl.cleo@example.com"
        emails[0].subject.includes("Estimate of Client project CLP1")
        emails[0].body.includes("Our estimate, for your approval")
        toOrg.workEffortApprovalId != null
        toOrg.emailedAddressList == []
    },
})

feature("review threads: a client who views a shared repository reads no review comment and makes, anchors or resolves none (P10b)", {
    when() {
        // a merge request of CL_REPO (CLP1 shares its repositories since the repositories feature) with John's line comment
        call("create#moqui.resource.GitMergeRequest", { mergeRequestId: "CL_MR", repositoryId: "CL_REPO", mergeRequestNum: 1, title: "Client access MR",
            sourceRef: "topic", targetRef: "main", statusId: "GmrOpen", authorUserId: "EX_JOHN_DOE", createdDate: ec.user.nowTimestamp,
            lastUpdatedDate: ec.user.nowTimestamp })
        const commentId = call("mantle.work.GitServices.create#ReviewComment", { mergeRequestId: "CL_MR", body: "ZQX the margin is thin",
            path: "a.txt", newLine: 1, lineText: "a" }).communicationEventId
        const errorsOf = (run) => { run(); const errors = ec.message.getErrorsString(); ec.message.clearErrors(); return errors }
        // as Cleo with authorization off, so the repository's view check passes and the client check alone refuses
        const cleo = asOff("cl.cleo", () => ({
            threads: Array.from(call("mantle.work.GitServices.get#ReviewThreads", { mergeRequestId: "CL_MR" }).threadList || []),
            comment: errorsOf(() => ec.service.sync().name("mantle.work.GitServices.create#ReviewComment").parameters({ mergeRequestId: "CL_MR", body: "client" }).call()),
            anchor: errorsOf(() => ec.service.sync().name("mantle.work.GitServices.store#ReviewAnchor").parameters({ communicationEventId: commentId,
                mergeRequestId: "CL_MR", path: "b.txt", newLine: 2 }).call()),
            resolve: errorsOf(() => ec.service.sync().name("mantle.work.GitServices.resolve#ReviewThread").parameters({ communicationEventId: commentId }).call()),
        }))
        const john = Array.from(call("mantle.work.GitServices.get#ReviewThreads", { mergeRequestId: "CL_MR" }).threadList || [])
        const comments = ec.entity.find(EVENT).condition("rootCommEventId", commentId).count() + ec.entity.find(EVENT).condition("communicationEventId", commentId).count()
        const root = ec.entity.find(EVENT).condition("communicationEventId", commentId).one()
        const anchor = ec.entity.find("mantle.party.communication.CommunicationEventGitAnchor").condition("communicationEventId", commentId).one()
        return { cleo, john, comments, status: root.statusId, path: anchor.path }
    },
    then({ cleo, john, comments, status, path }) {
        cleo.threads == []
        cleo.comment.includes("not found")
        cleo.anchor.includes("not found")
        cleo.resolve.includes("not found")
        john.length == 1
        john[0].commentList[0].body.includes("ZQX")
        comments == 1
        status == "CeSent"
        path == "a.txt"
    },
})
