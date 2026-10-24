// The foundation of IronStone Projects in mantle.work.ProjectServices (design-projects.md §15, impl-projects.md P1): task
// keys numbered from 1 without gaps in a new project and in a clone (init#ProjectSequence, create#Task with a bank of 1),
// an existing project keeping its numbers; the projects a user may see (get#VisibleProjectInfo: a Work group project only
// for its parties, General and All users projects for the users of their organization, a project with no visibility for
// its parties, Restricted tasks for their parties and the project's managers, ADMIN all); and a project's settings, its
// own WorkEffortSetting rows else its organization's Projects app setting (store#ProjectSetting, get#ProjectSettings).
// New spec, no Groovy original.
const effectiveTime = Date.now()
const dayMillis = 86400000
const PROJECT = "mantle.work.ProjectServices"
const users = {}
const parties = {}

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

const we = (id) => ec.entity.find("mantle.work.effort.WorkEffort").condition("workEffortId", id).one()
const task = (rootWorkEffortId, workEffortName, more) =>
    call("mantle.work.TaskServices.create#Task", Object.assign({ rootWorkEffortId, workEffortName }, more || {})).workEffortId
// get#VisibleProjectInfo as the user, with only this spec's projects (other specs' projects may be visible too)
function visibleAs(username) {
    login(username, username === "john.doe" ? "moqui" : "moqui1!!")
    try {
        const info = call(`${PROJECT}.get#VisibleProjectInfo`, {})
        const mine = (ids) => Array.from(ids || []).filter((id) => String(id).startsWith("PFV")).sort()
        // the condition a find of projects applies, as a list would
        const listed = info.allProjects ? null : Array.from(ec.entity.find("mantle.work.effort.WorkEffort").condition("workEffortTypeEnumId", "WetProject")
                .condition("workEffortId", "in", Array.from(info.visibleProjectIds)).condition("workEffortId", "like", "PFV%")
                .orderBy("workEffortId").list()).map((row) => row.workEffortId)
        return { allProjects: info.allProjects, visible: mine(info.visibleProjectIds), members: mine(info.memberProjectIds),
            managed: mine(info.managedProjectIds), restricted: mine(info.restrictedItemIds), orgIds: Array.from(info.orgIds || []), listed }
    } finally {
        login("john.doe")
    }
}

feature("a new project numbers its tasks from 1 without gaps; an existing project keeps its numbers", {
    when() {
        call(`${PROJECT}.create#Project`, { workEffortId: "PFK", workEffortName: "Keys project" })
        const ids = [task("PFK", "First"), task("PFK", "Second"), task("PFK", "Third")]
        // a project made before keys from 1: its sequence is where its tasks left it
        call("create#mantle.work.effort.WorkEffort", { workEffortId: "PFOLD", workEffortTypeEnumId: "WetProject", workEffortName: "Old project" })
        call("create#moqui.entity.SequenceValueItem", { seqName: "Project_PFOLD", seqNum: 100009 })
        const old = [task("PFOLD", "Old one"), task("PFOLD", "Old two")]
        // starting a sequence again leaves it as it is
        call(`${PROJECT}.init#ProjectSequence`, { workEffortId: "PFOLD" })
        const oldThird = task("PFOLD", "Old three")
        return { ids, old, oldThird, sequence: ec.entity.find("moqui.entity.SequenceValueItem").condition("seqName", "Project_PFK").one() }
    },
    then({ ids, old, oldThird, sequence }) {
        ids == ["PFK-1", "PFK-2", "PFK-3"]
        old == ["PFOLD-100010", "PFOLD-100011"]
        oldThird == "PFOLD-100012"
        sequence != null
    },
})

feature("clone#Project goes on after the copied numbers, and the copy is a template only when asked", {
    when() {
        call("update#mantle.work.effort.WorkEffort", { workEffortId: "PFK", isTemplate: "Y" })
        task("PFK", "Sub of first", { parentWorkEffortId: "PFK-1", workEffortId: "PFK-7" })
        call(`${PROJECT}.clone#Project`, { baseWorkEffortId: "PFK", workEffortId: "PFKC", workEffortName: "Keys copy" })
        call(`${PROJECT}.clone#Project`, { baseWorkEffortId: "PFK", workEffortId: "PFKT", workEffortName: "Keys template", isTemplate: "Y" })
        const copied = Array.from(ec.entity.find("mantle.work.effort.WorkEffort").condition("rootWorkEffortId", "PFKC").orderBy("workEffortId").list())
                .map((row) => row.workEffortId)
        return { copied, next: task("PFKC", "New in the copy"), copy: we("PFKC"), template: we("PFKT") }
    },
    then({ copied, next, copy, template }) {
        copied == ["PFKC-1", "PFKC-2", "PFKC-3", "PFKC-7"]
        next == "PFKC-8"
        copy.isTemplate == "N"
        template.isTemplate == "Y"
    },
})

feature("projects of two organizations, members and others, and a restricted task", {
    when() {
        const past = effectiveTime - dayMillis
        for (const [orgId, name] of [["PFV_ORG", "Foundation Works"], ["PFV_ORG2", "Foundation Other"]]) {
            call("create#mantle.party.Party", { partyId: orgId, partyTypeEnumId: "PtyOrganization", ownerPartyId: "_NA_" })
            call("create#mantle.party.Organization", { partyId: orgId, organizationName: name })
            call("create#mantle.party.PartyRole", { partyId: orgId, roleTypeId: "OrgInternal" })
        }
        // Mia and Nate employees of PFV_ORG, Mia a member of the Work group project; Olga of the other organization
        for (const [first, username, orgId] of [["Mia", "pfv.mia", "PFV_ORG"], ["Nate", "pfv.nate", "PFV_ORG"], ["Olga", "pfv.olga", "PFV_ORG2"]]) {
            const partyId = call("mantle.party.PartyServices.create#Person", { firstName: first, lastName: "Foundation" }).partyId
            users[first] = call("mantle.party.PartyServices.create#PartyUserAccount", { partyId, emailAddress: `${username}@example.com`, username,
                    newPassword: "moqui1!!", newPasswordVerify: "moqui1!!" }).userId
            parties[first] = partyId
            call("create#mantle.party.PartyRelationship", { relationshipTypeEnumId: "PrtEmployee", fromPartyId: partyId,
                    fromRoleTypeId: "Employee", toPartyId: orgId, toRoleTypeId: "OrgInternal", fromDate: past })
        }
        // General: PFV_ORG the vendor; All users: owned by PFV_ORG; Work group with Mia its project manager; no visibility
        call(`${PROJECT}.create#Project`, { workEffortId: "PFVGEN", workEffortName: "General project", visibilityEnumId: "WevGeneral",
                vendorPartyId: "PFV_ORG" })
        call(`${PROJECT}.create#Project`, { workEffortId: "PFVALL", workEffortName: "All users project", visibilityEnumId: "WevAllUsers",
                ownerPartyId: "PFV_ORG" })
        call(`${PROJECT}.create#Project`, { workEffortId: "PFVWG", workEffortName: "Work group project", visibilityEnumId: "WevWorkGroup",
                ownerPartyId: "PFV_ORG", assignToPartyId: parties.Mia, assignRoleTypeId: "ProjectManager" })
        call(`${PROJECT}.create#Project`, { workEffortId: "PFVNONE", workEffortName: "No visibility project", ownerPartyId: "PFV_ORG" })
        // a General project of the other organization
        call(`${PROJECT}.create#Project`, { workEffortId: "PFVOTHER", workEffortName: "Other organization project",
                visibilityEnumId: "WevGeneral", vendorPartyId: "PFV_ORG2" })
        // a Restricted task in the General project, Nate its assignee
        task("PFVGEN", "Restricted task", { workEffortId: "PFVGEN-1", visibilityEnumId: "WevRestricted", assignToPartyId: parties.Nate })
        return { general: we("PFVGEN"), workGroup: we("PFVWG") }
    },
    then({ general, workGroup }) {
        general.visibilityEnumId == "WevGeneral"
        workGroup.visibilityEnumId == "WevWorkGroup"
    },
})

feature("a Work group project stays out of a non-member's list; General and All users projects show to their organization", {
    when() {
        return { mia: visibleAs("pfv.mia"), nate: visibleAs("pfv.nate"), olga: visibleAs("pfv.olga"), john: visibleAs("john.doe") }
    },
    then({ mia, nate, olga, john }) {
        mia.allProjects == false
        mia.orgIds == ["PFV_ORG"]
        mia.visible == ["PFVALL", "PFVGEN", "PFVWG"]
        mia.members == ["PFVWG"]
        mia.managed == ["PFVWG"]
        mia.listed == ["PFVALL", "PFVGEN", "PFVWG"]
        nate.visible == ["PFVALL", "PFVGEN"]
        nate.members == []
        nate.managed == []
        nate.restricted == ["PFVGEN-1"]
        nate.listed == ["PFVALL", "PFVGEN"]
        !nate.listed.includes("PFVWG")
        olga.visible == ["PFVOTHER"]
        olga.listed == ["PFVOTHER"]
        john.allProjects == true
    },
})

feature("a project's settings: its own rows, else its organization's Projects app setting", {
    when() {
        call("create#mantle.party.PartySetting", { partyId: "PFV_ORG", partySettingTypeId: "ProjBillingDefaults",
                settingValue: '{"billingBasis":"TimeAndMaterials","shareHours":true}' })
        call("create#mantle.party.PartySetting", { partyId: "PFV_ORG", partySettingTypeId: "ProjConventions", settingValue: "not json" })
        const before = call(`${PROJECT}.get#ProjectSettings`, { workEffortId: "PFVGEN" })
        call(`${PROJECT}.store#ProjectSetting`, { workEffortId: "PFVGEN", settingTypeEnumId: "WstBillingBasis", settingValue: "FixedPrice" })
        call(`${PROJECT}.store#ProjectSetting`, { workEffortId: "PFVGEN", settingTypeEnumId: "WstModules", settingValue: "time,code" })
        const stored = call(`${PROJECT}.get#ProjectSettings`, { workEffortId: "PFVGEN" })
        call(`${PROJECT}.store#ProjectSetting`, { workEffortId: "PFVGEN", settingTypeEnumId: "WstBillingBasis", settingValue: "" })
        const cleared = call(`${PROJECT}.get#ProjectSettings`, { workEffortId: "PFVGEN" })
        // a project with no organization has only its own rows
        const loose = call(`${PROJECT}.get#ProjectSettings`, { workEffortId: "PFK" })
        const rows = Array.from(ec.entity.find("mantle.work.effort.WorkEffortSetting").condition("workEffortId", "PFVGEN").orderBy("settingTypeEnumId").list())
                .map((row) => row.settingTypeEnumId)
        return { before, stored, cleared, loose, rows }
    },
    then({ before, stored, cleared, loose, rows }) {
        before.organizationPartyId == "PFV_ORG"
        before.settings.WstBillingBasis == "TimeAndMaterials"
        before.settingSources.WstBillingBasis == "organization"
        before.settings.WstShareHours == "Y"
        before.settings.WstBranchPattern == null
        before.settings.WstModules == null
        stored.settings.WstBillingBasis == "FixedPrice"
        stored.settingSources.WstBillingBasis == "project"
        stored.settings.WstModules == "time,code"
        cleared.settings.WstBillingBasis == "TimeAndMaterials"
        cleared.settingSources.WstBillingBasis == "organization"
        rows == ["WstModules"]
        loose.organizationPartyId == null
        Object.keys(loose.settings).length == 0
    },
})
