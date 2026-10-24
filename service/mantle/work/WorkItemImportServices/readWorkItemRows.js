/*
 * This software is in the public domain under CC0 1.0 Universal plus a
 * Grant of Patent License.
 *
 * To the extent possible under law, the author(s) have dedicated all
 * copyright and related and neighboring rights to this software to the
 * public domain worldwide. This software is distributed without any
 * warranty.
 *
 * You should have received a copy of the CC0 Public Domain Dedication
 * along with this software (see the LICENSE.md file). If not, see
 * <http://creativecommons.org/publicdomain/zero/1.0/>.
 */

// mantle.work.WorkItemImportServices.read#WorkItemRows: a work item file's columns, and each row read into a work item's
// values (the text of each target field, with the type, status and priority through their value maps, dates as days,
// estimates as hours) and the problems of the row. Nothing is looked up in the database here: plan#WorkItemRows does that.
//
// A target field takes one column, by its name (columnMapping: target to column name). A name the file repeats (Jira's
// Labels, Sprint, Fix Version/s, Component/s) is one column whose values are all the non-empty ones of the row, in order:
// the labels are each of them (and a value with commas or semicolons split), the sprint is the last (the earlier ones are the
// sprints the item was carried over from), the release and component the first.

const L = (text, values) => ec.resource.expand(ec.l10n.localize(text), "", values || {})
columnList = []
rowList = []
rowCount = 0
distinctValues = {type: [], status: [], priority: []}

// ===== the target fields, for the mapping
const targets = [["sourceKey", "Original key"], ["sourceId", "Original id (for parent links)"], ["title", "Title"], ["type", "Type"],
    ["status", "Status"], ["priority", "Priority"], ["assignee", "Assignee"], ["reporter", "Reporter"], ["created", "Created"],
    ["start", "Start"], ["due", "Due"], ["resolved", "Resolved (done on)"], ["estimate", "Estimate"], ["points", "Story points"],
    ["description", "Description"], ["parentKey", "Parent (key or id)"], ["epicKey", "Epic (key)"], ["labels", "Labels"],
    ["milestone", "Milestone"], ["release", "Release or version"], ["sprint", "Sprint"], ["component", "Component"]]
targetFieldList = targets.map(([fieldName, description]) => ({fieldName, description: ec.l10n.localize(description)}))

// ===== the file's text, in its character set
let content = fileText
if (content == null && (workItemFile != null || fileLocation)) {
    const read = ec.service.sync().name("mantle.party.ContactImportServices.read#ContactFileText").parameters({contactFile: workItemFile,
        fileLocation: workItemFile != null ? null : fileLocation, characterSet: characterSet || "UTF-8"}).call()
    if (ec.message.hasError()) return
    content = read.text
}
if (content == null || String(content).trim() === "") { ec.message.addError(L("The work item file is empty")); return }
content = String(content)
if (content.charCodeAt(0) === 0xFEFF) content = content.substring(1)

// RFC 4180 records: quoted fields with doubled quotes and line breaks; the delimiter is the header line's commonest of comma,
// semicolon and tab
const firstLine = content.split(/\r?\n/, 1)[0]
const outside = firstLine.replace(/"[^"]*"/g, "")
const delimiter = [",", ";", "\t"].map((d) => [d, outside.split(d).length]).sort((a, b) => b[1] - a[1])[0][0]
const records = []
let record = []
let field = ""
let quoted = false
for (let i = 0; i < content.length; i++) {
    const ch = content[i]
    if (quoted) {
        if (ch === "\"") {
            if (content[i + 1] === "\"") { field += "\""; i++ } else quoted = false
        } else field += ch
    } else if (ch === "\"" && field === "") {
        quoted = true
    } else if (ch === delimiter) {
        record.push(field); field = ""
    } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && content[i + 1] === "\n") i++
        record.push(field); field = ""
        records.push(record); record = []
    } else field += ch
}
if (field !== "" || record.length) { record.push(field); records.push(record) }
const nonEmpty = records.filter((rec) => rec.some((value) => String(value).trim() !== ""))
if (!nonEmpty.length) { ec.message.addError(L("The work item file has no header line")); return }
const headerCells = nonEmpty[0].map((header) => String(header).trim())
// the columns by name, a repeated name once with its indexes
const names = []
const indexesOf = {}
headerCells.forEach((header, index) => {
    if (!header) return
    if (!indexesOf[header]) { indexesOf[header] = []; names.push(header) }
    indexesOf[header].push(index)
})
const dataRecords = nonEmpty.slice(1)
rowCount = dataRecords.length

// ===== presets: Jira, Redmine and GitHub issues exports, and a generic match by header words
const has = (name) => !!indexesOf[name]
const firstOf = (...candidates) => candidates.find((name) => has(name)) || null
const findPreset = () => {
    if (has("Issue key") && (has("Summary") || has("Issue Type"))) return "jira"
    if (has("Tracker") && has("Subject")) return "redmine"
    if ((has("Title") || has("title")) && (has("URL") || has("url") || has("Number") || has("number")) && (has("Assignees") || has("assignees") || has("Labels") || has("labels"))) return "github"
    return "generic"
}
presetId = ["jira", "redmine", "github", "generic"].includes(presetId) ? presetId : findPreset()
const presetMaps = {
    jira: {sourceKey: ["Issue key"], sourceId: ["Issue id"], title: ["Summary"], type: ["Issue Type"], status: ["Status"], priority: ["Priority"],
        assignee: ["Assignee"], reporter: ["Reporter"], created: ["Created"], start: ["Custom field (Start date)", "Start date"],
        due: ["Due date", "Due Date"], resolved: ["Resolved"], estimate: ["Original Estimate", "Original estimate"],
        points: ["Custom field (Story Points)", "Custom field (Story point estimate)", "Story Points", "Story point estimate"],
        description: ["Description"], parentKey: ["Parent key", "Parent", "Parent id"], epicKey: ["Custom field (Epic Link)", "Epic Link"],
        labels: ["Labels"], release: ["Fix Version/s", "Fix versions"], sprint: ["Sprint"], component: ["Component/s", "Components"]},
    redmine: {sourceKey: ["#"], title: ["Subject"], type: ["Tracker"], status: ["Status"], priority: ["Priority"], assignee: ["Assignee", "Assigned to"],
        reporter: ["Author"], created: ["Created"], start: ["Start date"], due: ["Due date"], resolved: ["Closed"], estimate: ["Estimated time"],
        description: ["Description"], parentKey: ["Parent task"], labels: ["Tags"], release: ["Target version"], component: ["Category"]},
    github: {sourceKey: ["Number", "number"], title: ["Title", "title"], type: ["Type", "Issue Type"], status: ["Status", "State", "state"],
        priority: ["Priority"], assignee: ["Assignees", "assignees", "Assignee"], reporter: ["Author", "author"], created: ["Created", "createdAt", "Created At"],
        start: ["Start date", "Start"], due: ["Due date", "Target date"], resolved: ["Closed", "closedAt", "Closed At"], estimate: ["Estimate"],
        description: ["Body", "body", "Description"], parentKey: ["Parent issue", "Parent"], labels: ["Labels", "labels"], milestone: ["Milestone", "milestone"],
        release: ["Iteration release", "Release"], sprint: ["Iteration", "Sprint"]}
}
const genericWords = {sourceKey: /^(key|id|issue( key)?|#|number|ticket)$/i, title: /^(title|summary|subject|name|task)$/i, type: /^(type|issue type|tracker|kind)$/i,
    status: /^(status|state)$/i, priority: /^priority$/i, assignee: /^(assignee|assigned to|owner|assignees)$/i, reporter: /^(reporter|author|requester|created by)$/i,
    created: /^(created|created at|created on|date created)$/i, start: /^(start|start date|starts)$/i, due: /^(due|due date|deadline|end date|target date)$/i,
    resolved: /^(resolved|closed|completed|done on)$/i, estimate: /^(estimate|estimated hours|hours|estimated time)$/i, points: /^(story points|points)$/i,
    description: /^(description|details|body|notes)$/i, parentKey: /^(parent|parent key|parent id|parent task)$/i, epicKey: /^(epic|epic link)$/i,
    labels: /^(labels|tags|label|tag)$/i, milestone: /^milestone$/i, release: /^(release|version|fix version|target version)$/i, sprint: /^(sprint|iteration)$/i,
    component: /^(component|components|category|area)$/i}
const presetMapping = {}
for (const [target] of targets) {
    let column = null
    if (presetMaps[presetId] && presetMaps[presetId][target]) column = firstOf(...presetMaps[presetId][target])
    if (!column) column = names.find((name) => genericWords[target] && genericWords[target].test(name)) || null
    if (column) presetMapping[target] = column
}
const mapping = {}
for (const [target] of targets) {
    if (columnMapping && Object.prototype.hasOwnProperty.call(columnMapping, target)) {
        const column = columnMapping[target]
        if (column && has(String(column))) mapping[target] = String(column)
    } else if (presetMapping[target]) mapping[target] = presetMapping[target]
}
columnMapping = mapping
// Jira's Original Estimate is in seconds
const unit = estimateUnit === "seconds" || estimateUnit === "hours" ? estimateUnit : (presetId === "jira" && mapping.estimate && /original estimate/i.test(mapping.estimate) ? "seconds" : "hours")
estimateUnitUsed = unit

// ===== the value maps: the file's types, statuses and priorities to work item types, statuses and 1 to 9
const typeWord = (value) => {
    const text = String(value).toLowerCase()
    if (/bug|defect|fix|incident/.test(text)) return "WepFix"
    if (/improve|enhance/.test(text)) return "WepFeatureEnhance"
    if (/story|feature|epic|initiative/.test(text)) return "WepNewFeature"
    if (/test|qa/.test(text)) return "WepFeatureTest"
    if (/doc/.test(text)) return "WepDocument"
    if (/support|question/.test(text)) return "WepSupport"
    if (/research|spike|investigat/.test(text)) return "WepResearch"
    if (/deploy|release/.test(text)) return "WepDeployment"
    return "WepTask"
}
const statusWord = (value) => {
    const text = String(value).toLowerCase().trim()
    if (/cancel|won'?t|reject|invalid|duplicate|abandon/.test(text)) return "WeCancelled"
    if (/^closed$/.test(text)) return "WeClosed"
    if (/done|resolved|complete|closed|fixed|finished|merged/.test(text)) return "WeComplete"
    if (/review/.test(text)) return "WeInReview"
    if (/test|qa|verif/.test(text)) return "WeInTesting"
    if (/progress|doing|started|active|develop/.test(text)) return "WeInProgress"
    if (/hold|block|wait/.test(text)) return "WeOnHold"
    if (/to ?do|selected|ready|approved|accepted|planned/.test(text)) return "WeApproved"
    return "WeInPlanning"
}
const priorityWord = (value) => {
    const text = String(value).toLowerCase().trim()
    if (/^[1-9]$/.test(text)) return Number(text)
    if (/highest|blocker|immediate|urgent|critical|p0|p1/.test(text)) return 1
    if (/high|major|p2/.test(text)) return 3
    if (/lowest|trivial|p5/.test(text)) return 9
    if (/low|minor|p4/.test(text)) return 7
    return 5
}
const givenMaps = valueMaps || {}
const mapOf = (kind, value, guess) => {
    const given = givenMaps[kind] || {}
    const key = String(value).trim()
    if (Object.prototype.hasOwnProperty.call(given, key) && given[key] !== "" && given[key] != null) return given[key]
    return guess(key)
}
valueMapsUsed = {type: {}, status: {}, priority: {}}

// ===== the values of a row
const cellsOf = (rec, column) => column ? (indexesOf[column] || []).map((index) => rec[index] == null ? "" : String(rec[index]).trim()).filter((value) => value !== "") : []
const one = (rec, target) => cellsOf(rec, mapping[target])[0] || null
const months = {jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12}
const pad = (number) => String(number).padStart(2, "0")
// a day yyyy-MM-dd from ISO (2026-10-22, 2026-10-22T10:15:00Z, 2026-10-22 10:15), Jira (22/Oct/26 10:15 AM), US (10/22/2026) or dotted (22.10.2026)
const dayOf = (text) => {
    if (!text) return null
    let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text)
    if (match) return `${match[1]}-${pad(match[2])}-${pad(match[3])}`
    match = /^(\d{1,2})[/ -]([A-Za-z]{3})[A-Za-z]*[/ -](\d{2,4})/.exec(text)
    if (match && months[match[2].toLowerCase()]) {
        const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3])
        return `${year}-${pad(months[match[2].toLowerCase()])}-${pad(match[1])}`
    }
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(text)
    if (match) {
        const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3])
        return `${year}-${pad(match[1])}-${pad(match[2])}`
    }
    match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(text)
    if (match) return `${match[3]}-${pad(match[2])}-${pad(match[1])}`
    return null
}
const numberOf = (text) => {
    if (text == null || text === "") return null
    const cleaned = String(text).replace(/[^0-9.,-]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", ".")
    const number = Number(cleaned)
    return cleaned === "" || !Number.isFinite(number) ? null : number
}
const splitList = (values) => {
    const out = []
    for (const value of values) for (const part of String(value).split(/[,;]/)) {
        const trimmed = part.trim()
        if (trimmed && !out.includes(trimmed)) out.push(trimmed)
    }
    return out
}
const keyOf = (text) => text ? String(text).trim().replace(/^#/, "") : null

const distinct = {type: new Set(), status: new Set(), priority: new Set()}
const sampleValues = {}
const limit = maxRows != null ? Number(maxRows) : null
dataRecords.forEach((rec, index) => {
    const rowNumber = index + 2
    for (const name of names) {
        if (!sampleValues[name]) sampleValues[name] = []
        if (sampleValues[name].length < 3) { const value = cellsOf(rec, name)[0]; if (value) sampleValues[name].push(value) }
    }
    const typeValue = one(rec, "type")
    const statusValue = one(rec, "status")
    const priorityValue = one(rec, "priority")
    if (typeValue) distinct.type.add(typeValue)
    if (statusValue) distinct.status.add(statusValue)
    if (priorityValue) distinct.priority.add(priorityValue)
    if (limit != null && rowList.length >= limit) return
    const problems = []
    const warnings = []
    const values = {}
    for (const name of names) { const cells = cellsOf(rec, name); values[name] = cells.length > 1 ? cells.join("; ") : (cells[0] ?? null) }
    const title = one(rec, "title")
    if (!title) problems.push(L("No title"))
    const purposeEnumId = typeValue ? mapOf("type", typeValue, typeWord) : "WepTask"
    const statusId = statusValue ? mapOf("status", statusValue, statusWord) : "WeInPlanning"
    let priority = priorityValue ? Number(mapOf("priority", priorityValue, priorityWord)) : 5
    if (!Number.isFinite(priority) || priority < 1 || priority > 9) priority = 5
    if (typeValue) valueMapsUsed.type[typeValue] = purposeEnumId
    if (statusValue) valueMapsUsed.status[statusValue] = statusId
    if (priorityValue) valueMapsUsed.priority[priorityValue] = priority
    const dateField = (target, label) => {
        const text = one(rec, target)
        if (!text) return null
        const day = dayOf(text)
        if (!day) warnings.push(L("${label} \"${text}\" is not a date we read; left empty", {label: ec.l10n.localize(label), text}))
        return day
    }
    const start = dateField("start", "Start")
    const due = dateField("due", "Due")
    if (start && due && due < start) warnings.push(L("Due before its start; the start is left empty"))
    const numberField = (target, label) => {
        const text = one(rec, target)
        if (!text) return null
        const number = numberOf(text)
        if (number == null || number < 0) { warnings.push(L("${label} \"${text}\" is not a number; left empty", {label: ec.l10n.localize(label), text})); return null }
        return number
    }
    let estimate = numberField("estimate", "Estimate")
    if (estimate != null && unit === "seconds") estimate = Math.round(estimate / 36) / 100
    const sprints = cellsOf(rec, mapping.sprint)
    const item = {sourceKey: keyOf(one(rec, "sourceKey")), sourceId: keyOf(one(rec, "sourceId")), title: title,
        typeValue: typeValue, purposeEnumId: purposeEnumId, statusValue: statusValue, statusId: statusId, priorityValue: priorityValue, priority: priority,
        assignee: splitList(cellsOf(rec, mapping.assignee))[0] || null, reporter: one(rec, "reporter"),
        createdDay: dateField("created", "Created"), startDay: start && due && due < start ? null : start, dueDay: due, resolvedDay: dateField("resolved", "Resolved"),
        estimate: estimate, points: numberField("points", "Story points"), description: one(rec, "description"),
        parentKey: keyOf(one(rec, "parentKey")) || keyOf(one(rec, "epicKey")),
        labels: splitList(cellsOf(rec, mapping.labels)), milestone: one(rec, "milestone"), release: one(rec, "release"),
        sprint: sprints.length ? sprints[sprints.length - 1] : null, earlierSprints: sprints.slice(0, -1), component: one(rec, "component")}
    rowList.push({rowNumber: rowNumber, values: values, item: item, problems: problems, warnings: warnings, empty: false})
})
columnList = names.map((name, index) => ({columnIndex: index, columnName: name, count: indexesOf[name].length, sampleValues: sampleValues[name] || [],
    targetField: Object.keys(mapping).find((target) => mapping[target] === name) || null}))
distinctValues = {type: Array.from(distinct.type), status: Array.from(distinct.status), priority: Array.from(distinct.priority)}
for (const value of distinctValues.type) if (!(value in valueMapsUsed.type)) valueMapsUsed.type[value] = mapOf("type", value, typeWord)
for (const value of distinctValues.status) if (!(value in valueMapsUsed.status)) valueMapsUsed.status[value] = mapOf("status", value, statusWord)
for (const value of distinctValues.priority) if (!(value in valueMapsUsed.priority)) valueMapsUsed.priority[value] = Number(mapOf("priority", value, priorityWord))
