# mantle-usl tests

JavaScript spec files that `moqui test` runs, ported from the Spock specs in `src/test/groovy`. They run in the same
script engine as the services, on a database loaded with every data type. Each `*.spec.js` file is one Spock
specification; `suite.js` gives the order, as `MantleUslSuite` did.

```sh
moqui test mantle-usl                                  # every spec, fresh database (about 20s to load)
moqui test mantle-usl --db snapshot                    # load once, restore the saved dump on later runs
moqui test mantle-usl --spec OrderToCashBasicFlow      # one spec and the specs its dependsOn names
moqui test mantle-usl --spec OrderToCashBasicFlow --feature "ship Sales Order"
moqui test mantle-usl --junit build/test-results       # JUnit XML for CI
moqui test mantle-usl --coverage                       # list the services no spec called, per service file
moqui test mantle-usl --coverage-report cov.txt        # the same with call counts, in a file
moqui test mantle-usl --keep --log-level info          # keep the scratch runtime, more on the console
```

The console shows a line per feature and the failures in full at the end; everything is logged to `runtime/log/moqui.log`.
The guide to `moqui test` is `docs/Testing.md` in the mr-moqui repository, and the design record `plans/archive/TestHarness.md`.

Besides the ports of the Spock specs, there are thirty-five specs without a Groovy original (HumanResServices, PayrollServices, PayrollAdjustments,
BankFileServices, FinancialReports, ShipmentLoads, PaymentGateway and others) that run the services the flows never reach, 751 of the 762
(`moqui test mantle-usl --coverage` lists the rest); `plans/archive/MantleFlowTests.md` in the mr-moqui repository lists them. A spec that
calls a data-dependent service on a product the flows also use (DEMO_1_1, DEMO_2_1, DEMO_3_1) can see their inventory and reservations when
it runs after them, so the newer specs receive their own stock or use DEMO_1_2.
A spec that needs its own books creates an organization and calls `init#PartyAccountingConfiguration` with `sourcePartyId: "DefaultSettings"`.

## A spec file

```js
const effectiveTime = Date.now()
let cartOrderId                                     // @Shared fields: file-level lets

spec({
    dependsOn: ["OrderProcureToPayBasicFlow"],      // run first when this spec is picked alone with --spec
    tempSequences: { start: 55500, banks: { "mantle.order.OrderHeader": 10 } },   // reset after cleanupSpec
    setupSpec() { ec.user.setEffectiveTime(effectiveTime) },                      // reset after the spec
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

feature("create Sales Order", {
    when() {
        login("joe@public.com")
        const priceMap = call("mantle.product.PriceServices.get#ProductPrice", { productId: "DEMO_1_1" })
        cartOrderId = call("mantle.order.OrderServices.add#OrderProductQuantity", { productId: "DEMO_1_1", quantity: 1 }).orderId
        const dataCheckErrors = checkData(`<entity-facade-xml>
            <mantle.order.OrderHeader orderId="${cartOrderId}" entryDate="${effectiveTime}" grandTotal="200.68"/>
        </entity-facade-xml>`)
        return { priceMap, dataCheckErrors }         // what then() reads
    },
    then({ priceMap, dataCheckErrors }) {
        priceMap.price == 16.99
        dataCheckErrors.length == 0
    },
})
```

- `spec({...})` once per file: `dependsOn`, `stepwise` (skip the rest after a failure, Spock `@Stepwise`),
  `allowMessageErrors`, `timeout` (seconds per block), `tempSequences`, and `setupSpec`, `cleanupSpec`, `setup`, `cleanup`.
- `feature(name, {...})` as a statement at the top level of the file, in run order. Blocks: `given`, `when` with `then`, or
  `expect` alone, and `cleanup` (always runs). Each block gets `ctx`: the `where` row's fields and what earlier blocks
  returned. Other fields: `where` (an array of row objects, or a function returning one; `#field` in the name is the row's
  value), `ignore: "reason"`, `timeout`, `allowMessageErrors`.
- Each expression statement directly in `then` or `expect` is a condition, as in a Spock `then:` block. A false one fails
  the feature with the values of its parts:

  ```
  Condition not satisfied:

  priceMap.price == 16.99
  |        |     |
  |        16.98 false
  {"price":"16.98","priceUomId":"USD"}
  ```

  `==`, `!=`, `<`, `<=`, `>`, `>=` compare as Groovy does: decimals, numbers and number text by value (`16.990 == 16.99`),
  lists and maps by their items. `!x` and a bare value use Groovy truth (an empty list, map or string, and zero, are false).
  `===` stays strict. An assignment is not a condition, and a call that returns `undefined` passes.
- A feature fails when it leaves errors in `ec.message`, unless `allowMessageErrors` is set. Messages are cleared between
  features.

Helpers: `call(name, params)` (throws naming the service and its errors), `checkData(xml)` (the messages of what did not
match; a failure lists them), `login(username, password = "moqui")`, `logout()`, `screenTest(baseScreenPath)`
(`render(path, params, method)` returns `output`, `errorMessages`, `assertContains`), `parallel(n, fn, args, opts)`, `assert(condition, message)`,
`sum(list, field)`, `dec(value)`, `uploadedFile(fileName, text, contentType)` (the `FileItem` for the services that take an upload), `log`. `ec` is the full script `ec`, as in a service.

## From Groovy

| Spock / Groovy | spec file |
|---|---|
| `class X extends Specification` | `X.spec.js` with `spec({...})` |
| `@Shared String cartOrderId` | `let cartOrderId` at the top of the file |
| `def setupSpec()`, `setup()`, `cleanup()`, `cleanupSpec()` | the same names in `spec({...})` |
| `ec.entity.tempSetSequencedIdPrimary(name, 55500, 10)` in setupSpec, reset in cleanupSpec | `tempSequences: { start: 55500, banks: { name: 10 } }` |
| `ec.user.setEffectiveTime(new Timestamp(effectiveTime))` | `ec.user.setEffectiveTime(effectiveTime)` |
| `def "create Sales Order"() { when: ... then: ... }` | `feature("create Sales Order", { when() {...}, then(ctx) {...} })` |
| a local of `when:` read in `then:` | returned from `when()`, destructured in `then({ ... })` |
| `expect:` / `where:` table / `@Unroll` | `expect(row) {...}`, `where: [{...}, ...]`, `#field` in the name |
| `ec.service.sync().name(n).parameters([a:1]).call()` | `call(n, { a: 1 })` |
| `"""<entity-facade-xml>...${x}...</entity-facade-xml>"""` with `makeDataLoader().xmlText(..).check()` | `` checkData(`<entity-facade-xml>...${x}...`) `` |
| `dataCheckErrors.size() == 0` | `dataCheckErrors.length == 0` |
| `ec.user.loginUser("john.doe", "moqui")` | `login("john.doe")` |
| `logger.info(...)` | `log.info(...)` |
| `new Timestamp(effectiveTime)`, `"${effectiveTime}"` in data | `effectiveTime` (time stamps are epoch millis text in scripts and data) |
| `new Date(effectiveTime + n)` | `new Date(effectiveTime + n)` (converts to a time stamp) |
| `list.sum { it.availableToPromiseTotal }` | `sum(list, "availableToPromiseTotal")` |
| `a + b` on BigDecimal | `dec(a).add(b)`; `.subtract`, `.multiply`, `.negate()`, `.compare()` |
| `Thread.start {}` with a `CountDownLatch` | `parallel(5, (threadNum, args) => {...}, { effectiveTime })` |
| `ec.screen.makeTest().baseScreenPath("rest")` | `screenTest("rest")` |
| `for (x in list) assert ...` | `for (const x of list) assert(...)` |

## Pitfalls

- A line that starts with `[`, `(` or a template literal continues the line before it (JavaScript has no semicolon there),
  so `x == 1` followed by `[a, b] == c` is one expression. Start such a line with `;` or put the list in a variable.
- Only expression statements directly in `then` and `expect` are conditions; inside an `if`, a loop or a callback use
  `assert(...)`. A `then` built outside a top-level `feature(...)` call is refused rather than run unchecked.
- Decimals from services are objects: `+`, `<` and `Number()` on them throw outside a condition. Use their methods, or `dec`.
- `parallel` runs its function from its source text on other threads, each with its own `ec`: it cannot use the spec's
  variables; pass what it needs in `args` (copied as JSON) and return JSON-friendly values.
- REST output is JSON written as Java's Jackson writes it, `"key" : value`, so the Groovy originals' expected text holds.
