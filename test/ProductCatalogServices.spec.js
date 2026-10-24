// Product, feature, variant, category, content and store services the flows do not reach (mantle.product.ProductServices
// and StoreServices). New spec, no Groovy original.
const effectiveTime = Date.now()
let groupId, baseId, categoryId, sizeFeatureIds = [], colorFeatureIds = [], variantId, cloneId, storeId, storeCloneId

spec({
    stepwise: true,
    tempSequences: { start: 56600, banks: { "mantle.product.Product": 20, "mantle.product.feature.ProductFeature": 20,
        "mantle.product.category.ProductCategory": 10, "mantle.product.store.ProductStore": 10 } },
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(effectiveTime)
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

feature("create a product, features and a category", {
    when() {
        baseId = call("create#mantle.product.Product", { pseudoId: "TSHIRT", productName: "Test Shirt", productTypeEnumId: "PtAsset",
                assetTypeEnumId: "AstTpInventory", assetClassEnumId: "AsClsInventoryFin" }).productId
        for (const [desc, abbrev] of [["Small", "S"], ["Large", "L"]]) {
            sizeFeatureIds.push(call("mantle.product.ProductServices.create#ProductFeature",
                    { productFeatureTypeEnumId: "PftSize", description: desc, abbrev }).productFeatureId)
        }
        colorFeatureIds.push(call("mantle.product.ProductServices.create#ProductFeature",
                { productFeatureTypeEnumId: "PftColor", description: "Green", abbrev: "GR", productId: baseId, applTypeEnumId: "PfatStandard" }).productFeatureId)
        categoryId = call("create#mantle.product.category.ProductCategory", { categoryName: "Shirts", productCategoryTypeEnumId: "PctCatalog" }).productCategoryId
        groupId = call("create#mantle.product.feature.ProductFeatureGroup", { description: "Shirt Sizes" }).productFeatureGroupId
        for (const productFeatureId of sizeFeatureIds) call("create#mantle.product.feature.ProductFeatureGroupAppl", { productFeatureGroupId: groupId, productFeatureId, fromDate: effectiveTime - 1000 })
        call("create#mantle.product.feature.ProductCategoryFeatGrpAppl", { productCategoryId: categoryId, productFeatureGroupId: groupId, applTypeEnumId: "PfatSelectable", fromDate: effectiveTime - 1000 })
        return { ids: [baseId, categoryId, ...sizeFeatureIds, ...colorFeatureIds] }
    },
    then({ ids }) { ids.every(id => id != null) },
})

feature("find a product by an id value", {
    when() { return { byId: call("mantle.product.ProductServices.find#ProductByIdValue", { idValue: baseId }), byPseudo: call("mantle.product.ProductServices.find#ProductByIdValue", { idValue: "TSHIRT" }),
            none: call("mantle.product.ProductServices.find#ProductByIdValue", { idValue: "NO-SUCH-PRODUCT-ID" }) } },
    then({ byId, byPseudo, none }) {
        byId.productId == baseId
        byPseudo.productId == baseId
        none.productId == null
    },
})

feature("apply features, find features and feature groups", {
    when() {
        call("mantle.product.ProductServices.apply#ProductFeatures", { productId: baseId, applTypeEnumId: "PfatSelectable", productFeatureIdList: sizeFeatureIds })
        const selectable = call("mantle.product.ProductServices.find#ProductFeatures", { productId: baseId, applTypeEnumId: "PfatSelectable" })
        const all = call("mantle.product.ProductServices.find#ProductFeatures", { productId: baseId })
        const groups = call("mantle.product.ProductServices.find#ProductFeatureGroups", { productId: baseId })
        return { selectable, all, groups }
    },
    then({ selectable, all, groups }) {
        selectable.productFeatureList.length == 2
        all.productFeatureList.length == 3
        groups.productFeatureGroupList != null
    },
})

feature("add products to a category and category features", {
    when() {
        call("mantle.product.ProductServices.add#ProductsToCategory", { productCategoryId: categoryId, productIdList: [baseId] })
        const members = ec.entity.find("mantle.product.category.ProductCategoryMember").condition("productCategoryId", categoryId).list()
        const features = call("mantle.product.ProductServices.find#ProductCategoryFeatures", { productCategoryId: categoryId })
        const featureList = call("mantle.product.ProductServices.get#ProductCategoryFeatureList", { productCategoryId: categoryId })
        return { members, features, featureList }
    },
    then({ members, features, featureList }) {
        members.length == 1
        features.productFeatureList.length == 2
        featureList.resultList.length == 2
    },
})

feature("create variant products from the selectable features", {
    when() {
        call("mantle.product.ProductServices.create#VariantProducts", { productId: baseId, productTypeEnumId: "PtAsset", assetTypeEnumId: "AstTpInventory" })
        const assoc = ec.entity.find("mantle.product.ProductAssoc").condition("productId", baseId).condition("productAssocTypeEnumId", "PatVariant").list()
        const found = call("mantle.product.ProductServices.find#VariantProduct", { baseProductId: baseId, productFeatureIdSet: [sizeFeatureIds[0]] })
        variantId = found.productId
        const info = call("mantle.product.ProductServices.get#VariantProductsInfo", { productId: baseId })
        return { assoc, found, info }
    },
    then({ assoc, found, info }) {
        assoc.length == 2
        found.productId != null
        // get#VariantProductsInfo is a stub in mantle-usl (a TODO after the feature query), so it returns nothing yet
        info != null
    },
})

feature("clone a product", {
    when() {
        cloneId = call("mantle.product.ProductServices.clone#Product", { baseProductId: baseId, productId: "TSHIRT_CLONE", productName: "Cloned Shirt" }).productId
        const clone = ec.entity.find("mantle.product.Product").condition("productId", cloneId).one()
        const features = ec.entity.find("mantle.product.feature.ProductFeatureAppl").condition("productId", cloneId).list()
        const cats = ec.entity.find("mantle.product.category.ProductCategoryMember").condition("productId", cloneId).list()
        return { clone, features, cats }
    },
    then({ clone, features, cats }) {
        clone.productName == "Cloned Shirt"
        features.length >= 1
        cats.length == 1
    },
})

feature("add and remove a feature to products, remove products from a category", {
    when() {
        const extra = call("mantle.product.ProductServices.create#ProductFeature", { productFeatureTypeEnumId: "PftColor", description: "Teal", abbrev: "TL" }).productFeatureId
        call("mantle.product.ProductServices.add#FeatureToProducts", { productFeatureId: extra, applTypeEnumId: "PfatDistinguishing", productIdList: [baseId, cloneId] })
        const added = ec.entity.find("mantle.product.feature.ProductFeatureAppl").condition("productFeatureId", extra).list()
        call("mantle.product.ProductServices.remove#FeatureFromProducts", { productFeatureId: extra, productIdList: [cloneId] })
        const afterRemove = ec.entity.find("mantle.product.feature.ProductFeatureAppl").condition("productFeatureId", extra).condition("thruDate", null).list()
        call("mantle.product.ProductServices.remove#ProductsFromCategory", { productCategoryId: categoryId, productIdList: [cloneId] })
        const openMembers = ec.entity.find("mantle.product.category.ProductCategoryMember").condition("productCategoryId", categoryId)
                .condition("productId", cloneId).condition("thruDate", null).list()
        return { added, afterRemove, openMembers }
    },
    then({ added, afterRemove, openMembers }) {
        added.length == 2
        afterRemove.length == 1
        openMembers.length == 0
    },
})

feature("product content from text", {
    when() {
        const contentId = call("mantle.product.ProductServices.create#ProductContent", { productId: baseId, productContentTypeEnumId: "PcntDescriptionLong",
                contentText: "<p>Soft cotton</p>" }).productContentId
        call("mantle.product.ProductServices.update#ProductContent", { productContentId: contentId, contentText: "<p>Softer cotton</p>" })
        const content = ec.entity.find("mantle.product.ProductContent").condition("productContentId", contentId).one()
        const catContentId = call("mantle.product.ProductServices.create#ProductCategoryContent", { productCategoryId: categoryId,
                productCategoryContentTypeEnumId: "PcctDescription", contentText: "All shirts" }).productCategoryContentId
        call("mantle.product.ProductServices.update#ProductCategoryContent", { productCategoryContentId: catContentId, contentText: "All the shirts" })
        const prodFileId = call("mantle.product.ProductServices.create#ProductContent", { productId: baseId, productContentTypeEnumId: "PcntImageLarge", contentFile: uploadedFile("p.txt", "big image") }).productContentId
        call("mantle.product.ProductServices.update#ProductContent", { productContentId: prodFileId, contentFile: uploadedFile("p2.txt", "big image 2") })
        const catFileId = call("mantle.product.ProductServices.create#ProductCategoryContent", { productCategoryId: categoryId, productCategoryContentTypeEnumId: "PcctDescription", contentFile: uploadedFile("c.txt", "cat file") }).productCategoryContentId
        call("mantle.product.ProductServices.update#ProductCategoryContent", { productCategoryContentId: catFileId, contentFile: uploadedFile("c2.txt", "cat file 2") })
        return { content, catContentId }
    },
    then({ content, catContentId }) {
        content.productId == baseId
        content.contentLocation != null
        catContentId != null
    },
})

feature("create a store, shipping options, URL slugs and clone the store", {
    when() {
        storeId = call("create#mantle.product.store.ProductStore", { storeName: "Shirt Store", organizationPartyId: "ORG_ZIZI_RETAIL" }).productStoreId
        call("mantle.product.StoreServices.create#StoreShippingOption", { productStoreId: storeId, carrierPartyId: "_NA_", shipmentMethodEnumId: "ShMthGround", sequenceNum: 1 })
        const options = call("mantle.product.StoreServices.get#StoreShippingOptions", { productStoreId: storeId })
        const slug = call("mantle.product.StoreServices.format#UrlSlug", { inUrlSlug: "Soft Cotton T-Shirt!" })
        const productSlug = call("mantle.product.StoreServices.generate#UrlSlugFromProductName", { productId: baseId })
        const categorySlug = call("mantle.product.StoreServices.generate#UrlSlugFromCategoryName", { productCategoryId: categoryId, categoryName: "Shirts & Tops" })
        storeCloneId = call("mantle.product.StoreServices.clone#ProductStore", { baseProductStoreId: storeId, storeName: "Shirt Store 2" }).productStoreId
        const clone = ec.entity.find("mantle.product.store.ProductStore").condition("productStoreId", storeCloneId).one()
        return { options, slug, productSlug, categorySlug, clone }
    },
    then({ options, slug, productSlug, categorySlug, clone }) {
        options.shippingOptions != null
        slug.outUrlSlug == "soft-cotton-t-shirt"
        productSlug.outUrlSlug == "test-shirt"
        categorySlug.outUrlSlug != null
        clone.storeName == "Shirt Store 2"
    },
})

feature("delete a product with its variants", {
    when() {
        // the URL slug made above is a ProductOtherIdentification, which delete#Product does not remove: the product stays
        call("mantle.product.ProductServices.delete#Product", { productId: baseId })
        const kept = ec.entity.find("mantle.product.Product").condition("productId", baseId).one()
        ec.entity.find("mantle.product.ProductOtherIdentification").condition("productId", baseId).deleteAll()
        call("mantle.product.ProductServices.delete#Product", { productId: baseId })
        const left = ec.entity.find("mantle.product.Product").condition("productId", baseId).one()
        const assocs = ec.entity.find("mantle.product.ProductAssoc").condition("productId", baseId).list().length
        return { kept, left, assocs }
    },
    then({ kept, left, assocs }) {
        kept != null
        left == null
        assocs == 0
    },
})
