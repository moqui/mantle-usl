// Git repositories of projects, and their commits, branches and tags on tasks: mantle.work.GitServices and the gitECA
// rules of service/Work.gitecas.xml, on a database repository whose commits are made through
// org.moqui.impl.GitServices.commit#GitFiles (a write, which the rules listen for as for a push). The push itself, the
// rules engine and the HTTP and SSH endpoints are tested in mr-moqui. New spec, no Groovy original.
const PROJECT = "GITP"
let repositoryId, taskOne, taskTwo, taskThree

spec({
    requires: ["git"],
    stepwise: true,
    setupSpec() { login("john.doe") },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

const countOf = (entityName, fields) => ec.entity.find(entityName).condition(fields).count()
const workEffort = (workEffortId) => ec.entity.find("mantle.work.effort.WorkEffort").condition("workEffortId", workEffortId).one()

// The gitECA post events of a change run on the git pool after it commits: wait for the repository's updates to finish,
// running any left pending here.
function settle() {
    const started = Date.now()
    while (Date.now() - started < 20000) {
        const busy = ["recording", "pending", "running"].reduce((sum, status) =>
            sum + countOf("moqui.resource.GitUpdate", { repositoryId, ecaStatus: status }), 0)
        if (busy == 0) return
        call("org.moqui.impl.GitServices.process#PendingGitUpdates", {})
    }
    throw new Error("the git updates did not settle")
}

function commitFiles(message, fileMap) {
    const out = call("org.moqui.impl.GitServices.commit#GitFiles", { repositoryId, message, fileMap })
    settle()
    return out.commitId
}

function failures() {
    return Array.from(ec.entity.find("moqui.resource.GitUpdate").condition("repositoryId", repositoryId).list())
        .filter((update) => update.ecaStatus == "failed").map((update) => update.ecaError)
}

function commitLinks() {
    return Array.from(ec.entity.find("mantle.work.effort.WorkEffortGitCommit").condition("repositoryId", repositoryId)
        .orderBy("workEffortId").orderBy("commitDate").list())
}

feature("create a project with tasks and a repository", {
    when() {
        call("mantle.work.ProjectServices.create#Project", { workEffortId: PROJECT, workEffortName: "Git Project" })
        taskOne = call("mantle.work.TaskServices.create#Task", { rootWorkEffortId: PROJECT, workEffortName: "Log in",
            statusId: "WeInProgress" }).workEffortId
        taskTwo = call("mantle.work.TaskServices.create#Task", { rootWorkEffortId: PROJECT, workEffortName: "Log out",
            statusId: "WeInPlanning" }).workEffortId
        taskThree = call("mantle.work.TaskServices.create#Task", { rootWorkEffortId: PROJECT, workEffortName: "Help page" })
            .workEffortId
        repositoryId = call("mantle.work.GitServices.create#ProjectRepository", { workEffortId: PROJECT,
            repositoryKind: "db" }).repositoryId
        return { projectIds: Array.from(call("mantle.work.GitServices.get#RepositoryProjects", { repositoryId }).projectIdList) }
    },
    then({ projectIds }) {
        repositoryId == "gitp"
        taskOne.startsWith(PROJECT + "-")
        countOf("mantle.work.effort.WorkEffortGitRepository", { workEffortId: PROJECT, repositoryId }) == 1
        projectIds == [PROJECT]
    },
})

feature("a commit message and a Task trailer link tasks", {
    when() {
        const first = commitFiles(`Log in with a token for ${taskOne}\n\nAlso UTF-8 and ${PROJECT}-NOPE are not tasks.\n\nTask: ${taskThree}`,
            { "src/login.js": "login()\n" })
        return { first, links: commitLinks() }
    },
    then({ first, links }) {
        failures() == []
        links.map((link) => link.workEffortId) == [taskOne, taskThree].sort()
        links.find((link) => link.workEffortId == taskOne).commitId == first
        links.find((link) => link.workEffortId == taskOne).linkSourceEnumId == "WglsMessage"
        links.find((link) => link.workEffortId == taskOne).summary == `Log in with a token for ${taskOne}`
        links.find((link) => link.workEffortId == taskOne).refName == "refs/heads/main"
        links.find((link) => link.workEffortId == taskThree).linkSourceEnumId == "WglsTrailer"
    },
})

feature("Fixes and Closes complete their tasks on the default branch", {
    when() {
        commitFiles(`Fixes ${taskOne}: the token expires\n\nCloses ${taskTwo}`, { "src/login.js": "login(token)\n" })
        return { one: workEffort(taskOne), two: workEffort(taskTwo) }
    },
    then({ one, two }) {
        failures() == []
        one.statusId == "WeComplete"
        one.resolutionEnumId == "WerCompleted"
        // the Default status flow goes from In Planning to Complete too
        two.statusId == "WeComplete"
        countOf("mantle.work.effort.WorkEffortGitCommit", { workEffortId: taskOne }) == 2
    },
})

feature("a commit linked by hand by an ID prefix, and one that is not there", {
    when() {
        const head = call("org.moqui.impl.GitServices.get#GitLog", { repositoryId, limit: 1 }).commitList[0].commitId
        call("mantle.work.GitServices.add#TaskCommit", { workEffortId: taskThree, repositoryId, commitId: head.substring(0, 8) })
        let error = ""
        try {
            call("mantle.work.GitServices.add#TaskCommit", { workEffortId: taskThree, repositoryId, commitId: "deadbeef" })
        } catch (e) { error = String(e.message) }
        ec.message.clearErrors()
        return { head, error }
    },
    then({ head, error }) {
        ec.entity.find("mantle.work.effort.WorkEffortGitCommit")
            .condition({ workEffortId: taskThree, repositoryId, commitId: head }).one().linkSourceEnumId == "WglsExplicit"
        error.includes("No commit deadbeef")
    },
})

feature("branch and tag names link to their task or project", {
    when() {
        const head = call("org.moqui.impl.GitServices.get#GitLog", { repositoryId, limit: 1 }).commitList[0].commitId
        // what the ref-update and tag rules call for a branch or tag a push creates
        for (const refName of [`refs/heads/${taskThree}-help-text`, `refs/tags/${PROJECT}/v1.0`, `refs/tags/${taskTwo}/done`]) {
            call("mantle.work.GitServices.link#RefByName", { repositoryId, refName, newId: head,
                tag: refName.startsWith("refs/tags/") ? { commitId: head, annotated: false } : null })
        }
        call("mantle.work.GitServices.link#RefByName", { repositoryId, refName: "refs/heads/feature/nothing-here", newId: head })
        const refs = Array.from(ec.entity.find("mantle.work.effort.WorkEffortGitRef").condition("repositoryId", repositoryId)
            .orderBy("refName").list()).map((ref) => [ref.workEffortId, ref.refName, ref.linkSourceEnumId])
        call("mantle.work.GitServices.close#RefLinks", { repositoryId, refName: `refs/heads/${taskThree}-help-text` })
        const closed = ec.entity.find("mantle.work.effort.WorkEffortGitRef")
            .condition({ workEffortId: taskThree, repositoryId, refName: `refs/heads/${taskThree}-help-text` }).one()
        return { refs, closed }
    },
    then({ refs, closed }) {
        // by ref name: '-' sorts before '/'
        refs == [
            [taskThree, `refs/heads/${taskThree}-help-text`, "WglsBranchName"],
            [taskTwo, `refs/tags/${taskTwo}/done`, "WglsTagName"],
            [PROJECT, `refs/tags/${PROJECT}/v1.0`, "WglsTagName"],
        ]
        closed.thruDate != null
    },
})

feature("the members of a project may use its repositories", {
    when() {
        const account = call("mantle.party.PartyServices.create#Account", { firstName: "Git", lastName: "Member",
            emailAddress: "git.member@test.com", username: "git.member", newPassword: "moqui1!!",
            newPasswordVerify: "moqui1!!", loginAfterCreate: false })
        const check = (action) => call("mantle.work.GitServices.check#GitRepositoryAuthz", { userId: account.userId,
            authzActionEnumId: action, artifactName: repositoryId }).authzTypeEnumId
        const before = check("AUTHZA_VIEW")
        call("create#mantle.work.effort.WorkEffortParty", { workEffortId: PROJECT, partyId: account.partyId,
            roleTypeId: "Assignee", fromDate: ec.user.nowTimestamp })
        return { before, view: check("AUTHZA_VIEW"), update: check("AUTHZA_UPDATE"), del: check("AUTHZA_DELETE") }
    },
    then({ before, view, update, del }) {
        before == "AUTHZT_NONE"
        view == "AUTHZT_ALLOW"
        update == "AUTHZT_ALLOW"
        del == "AUTHZT_NONE"
    },
})
