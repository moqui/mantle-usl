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

// NOTE: a find builder is used up by each call, so each call is assigned back to ef
// NOTE: doing a find with a static view-entity because the Entity Facade will only select the fields specified and the
//     join in the associated member-entities
// don't do distinct, SQL quandary with distinct, limited select, and order by with upper needing to be selected; seems to get good results in general without: .distinct(true)
let ef = ec.entity.find("mantle.party.FindPartyView").distinct(true)

ef = ef.selectField("partyId")

const cf = ec.entity.conditionFactory
const wildcard = leadingWildcard ? "%" : ""
// a LIKE condition on the field with the value and a trailing wildcard, optionally ignoring case
const like = (field, value, ignoreCase = true) =>
        cf.makeActionConditionDirect(field, "like", wildcard + value + "%", null, null, ignoreCase)

if (partyId) ef = ef.condition(like("partyId", partyId))
if (pseudoId) ef = ef.condition(like("pseudoId", pseudoId))
if (partyTypeEnumId) ef = ef.condition("partyTypeEnumId", partyTypeEnumId)
if (disabled) ef = ef.condition("disabled", disabled)
if (customerStatusId) ef = ef.condition("customerStatusId", customerStatusId)
if (hasDuplicates) ef = ef.condition("hasDuplicates", hasDuplicates)
if (roleTypeId) ef = ef.condition("roleTypeId", roleTypeId)
if (username) ef = ef.condition(like("username", username))

if (combinedName) {
    // support splitting by just one space for first/last names
    let fnSplit = combinedName
    let lnSplit = combinedName
    if (combinedName.includes(" ")) {
        fnSplit = combinedName.substring(0, combinedName.indexOf(" "))
        lnSplit = combinedName.substring(combinedName.indexOf(" ") + 1)
    }
    const cnCondList = [like("organizationName", combinedName), like("firstName", fnSplit), like("lastName", lnSplit)]
    ef = ef.condition(cf.makeCondition(cnCondList, "or"))
}

if (organizationName) ef = ef.condition(like("organizationName", organizationName))
if (firstName) ef = ef.condition(like("firstName", firstName))
if (lastName) ef = ef.condition(like("lastName", lastName))
if (suffix) ef = ef.condition(like("suffix", suffix))

if (address1) ef = ef.condition(like("address1", address1))
if (address2) ef = ef.condition(like("address2", address2))
if (city) ef = ef.condition(like("city", city))
if (stateProvinceGeoId) ef = ef.condition("stateProvinceGeoId", stateProvinceGeoId)
if (postalCode) ef = ef.condition(like("postalCode", postalCode))

if (countryCode) ef = ef.condition("countryCode", countryCode)
if (areaCode) ef = ef.condition("areaCode", areaCode)
if (contactNumber) ef = ef.condition(like("contactNumber", contactNumber, false))

if (emailAddress) ef = ef.condition(like("emailAddress", emailAddress))

if (assetSerialNumber) ef = ef.condition(like("assetSerialNumber", assetSerialNumber))

const userId = ec.user.userId || null

// one text against the names, emails, phones and organizations, as one or-condition so the count stays exact
const anyText = anyField == null ? "" : String(anyField).trim()
if (anyText) {
    const branches = [like("organizationName", anyText), like("firstName", anyText), like("lastName", anyText)]
    // first and last name in either order, split at each space ("Mary Ann Lee": "Mary" + "Ann Lee", "Mary Ann" + "Lee")
    const words = anyText.replace(/,/g, " ").split(/\s+/).filter((word) => word)
    for (let split = 1; split < words.length; split++) {
        const head = words.slice(0, split).join(" ")
        const rest = words.slice(split).join(" ")
        branches.push(cf.makeCondition([like("firstName", head), like("lastName", rest)], "and"))
        branches.push(cf.makeCondition([like("lastName", head), like("firstName", rest)], "and"))
    }
    if (!/\s/.test(anyText)) {
        branches.push(cf.makeCondition([like("emailAddress", anyText), cf.makeCondition("emailContactMechTypeEnumId", "equals", "CmtEmailAddress"),
            cf.makeConditionDate("emailFromDate", "emailThruDate", null)], "and"))
    }
    // the parties found apart and added by id (an organization's people, phones by their digits), up to maxIds each, a
    // limit a text matching that many is past being a search; the finds run under the user's entity filters
    const maxIds = 5000
    const addIds = (branch, idSet) => {
        if (!idSet.size) return
        if (idSet.size >= maxIds) ec.logger.warn(`find#Party anyField ${anyText}: the ${branch} matches stop at ${maxIds}, the count may be short`)
        branches.push(cf.makeCondition("partyId", "in", Array.from(idSet)))
    }
    // the people whose current contact or employee relationship is to an organization of that name the user may see
    const orgIds = Array.from(ec.entity.find("mantle.party.PartyDetail").condition("partyTypeEnumId", "PtyOrganization")
            .condition(like("organizationName", anyText)).condition(cf.makeCondition("disabled", "not-equals", "Y", true))
            .condition(cf.makeCondition([cf.makeCondition("privateOwnerUserId", "equals", null),
                cf.makeCondition("privateOwnerUserId", "equals", userId ?? "_NA_")], "or"))
            .selectField("partyId").limit(maxIds).list()).map((org) => org.partyId)
    if (orgIds.length) {
        const memberIds = new Set()
        for (let start = 0; start < orgIds.length && memberIds.size < maxIds; start += 500) {
            for (const rel of ec.entity.find("mantle.party.PartyRelationship").condition(cf.makeCondition("toPartyId", "in", orgIds.slice(start, start + 500)))
                    .condition(cf.makeCondition("relationshipTypeEnumId", "in", ["PrtContact", "PrtEmployee"]))
                    .condition(cf.makeConditionDate("fromDate", "thruDate", null)).selectField("fromPartyId").limit(maxIds).list()) {
                if (memberIds.size < maxIds) memberIds.add(rel.fromPartyId)
            }
        }
        addIds("organization", memberIds)
    }
    // a phone by its digits: the numbers whose last digits are in the contact number, checked digit for digit here
    const digits = anyText.replace(/\D/g, "")
    if (digits.length >= 3 && /^[\d\s()+\-.\/]+$/.test(anyText)) {
        const tail = digits.slice(-4)
        // four digits may have a separator between them ("555-12" against 555-1234), fewer are taken as they are
        const pattern = "%" + (tail.length === 4 ? tail.split("").join("%") : tail) + "%"
        const phonePartyIds = new Set()
        for (const tn of ec.entity.find("mantle.party.contact.PartyContactMechTelecomNumber")
                .condition(cf.makeCondition("contactNumber", "like", pattern)).condition(cf.makeConditionDate("fromDate", "thruDate", null))
                .selectField("partyId,countryCode,areaCode,contactNumber").list()) {
            const local = `${tn.areaCode || ""}${tn.contactNumber || ""}`.replace(/\D/g, "")
            const full = `${tn.countryCode || ""}`.replace(/\D/g, "") + local
            // the digits in the number, with or without its country code; or the number with a country code (or an
            // international prefix) before it that it does not have
            const matches = full.includes(digits) || local.includes(digits) ||
                    (local.length >= 7 && digits.length > local.length && digits.length - local.length <= 5 && digits.endsWith(local))
            if (matches && phonePartyIds.size < maxIds) phonePartyIds.add(tn.partyId)
        }
        addIds("phone", phonePartyIds)
    }
    ef = ef.condition(cf.makeCondition(branches, "or"))
}

// any role; a personal contact has none, so the user's own still come unless personalContacts leaves them out
if (hasRole === true || hasRole === "true" || hasRole === "Y") {
    const withRole = cf.makeCondition("anyRoleTypeId", "is-not-null", null)
    if (userId && personalContacts !== "exclude") {
        ef = ef.condition(cf.makeCondition([withRole, cf.makeCondition("privateOwnerUserId", "equals", userId)], "or"))
    } else {
        ef = ef.condition(withRole)
    }
}

// a personal contact (privateOwnerUserId) is found only by its owner, whether or not an entity filter applies
if (personalContacts === "only") {
    ef = ef.condition(cf.makeCondition("privateOwnerUserId", "equals", userId ?? "_NA_"))
} else if (personalContacts === "exclude" || !userId) {
    ef = ef.condition(cf.makeCondition("privateOwnerUserId", "equals", null))
} else {
    ef = ef.condition(cf.makeCondition([cf.makeCondition("privateOwnerUserId", "equals", null),
        cf.makeCondition("privateOwnerUserId", "equals", userId)], "or"))
}

if (orderByField) {
    if (orderByField.includes("combinedName")) {
        if (orderByField.includes("-")) ef = ef.orderBy("-organizationName,-firstName,-lastName")
        else ef = ef.orderBy("organizationName,firstName,lastName")
    } else {
        ef = ef.orderBy(orderByField)
    }
}

// a find runs once, so count with a copy made before the limit and offset are set
const countFind = ef.copy()

const pageIndexInt = Math.trunc(Number(pageIndex))
const pageSizeInt = Math.trunc(Number(pageSize))
if (!pageNoLimit) ef = ef.offset(pageIndexInt * pageSizeInt).limit(pageSizeInt)

partyIdList = []
for (const ev of ef.list()) partyIdList.push(ev.partyId)

partyIdListCount = countFind.count()
// as the find reports them: page 0 of the default size 20 when there is no limit
partyIdListPageIndex = pageNoLimit ? 0 : pageIndexInt
partyIdListPageSize = pageNoLimit ? 20 : pageSizeInt
partyIdListPageMaxIndex = Math.trunc((partyIdListCount - 1) / partyIdListPageSize) + 0
partyIdListPageRangeLow = partyIdListPageIndex * partyIdListPageSize + 1
partyIdListPageRangeHigh = (partyIdListPageIndex * partyIdListPageSize) + partyIdListPageSize
if (partyIdListPageRangeHigh > partyIdListCount) partyIdListPageRangeHigh = partyIdListCount
