# Trailhead

A weekend-trip planner: pick a region and a number of days, get a route, a packing list and a weather check.
This is a made-up project. It exists to show what a board looks like; the pictures in the README are taken from it.

## GOALS

| # | Goal | One line | Cards | State |
|---|---|---|---|---|
| **1** | **A trip can be planned** | A visitor picks a region and a number of days and gets a route they can follow | 6 | ACTIVE |
| **2** | **People can find it** | The site is live on its own address, and a stranger can reach it and sign up | 5 | ACTIVE |
| **3** | **We know it works** | Twenty real trips have been planned, and we know where people gave up | 3 | ACTIVE |

## GOAL 1 — A trip can be planned

### Phase 1 · The planner

Ends with: a route a stranger can follow, on a phone

| ID | ST | OWN | TYPE | EFF | GATE | DEPS | Card | DONE-WHEN |
|---|---|---|---|---|---|---|---|---|
| 1.1 | DONE | agent | code | S | - | - | **Set up the project.** Create the app, the test runner and the first page. • Why: Everything else is built on it. • Check: The first page opens. • Verified: `npm test` passed 4 of 4 and the first page opened at 1440 and 390 wide with no error. | The first page opens and the tests run |
| 1.2 | DONE | agent | code | L | - | 1.1 | **Load the trail data.** Read the open trail data for three regions and keep only trails with a known length and climb. • Why: A route can only be built from trails we can measure. • Check: Three regions load. • Verified: 3 regions and 412 trails loaded; 37 trails with no length were left out and are listed in the log. | Three regions load with length and climb for every trail |
| 1.3 | DONE | agent | code | L | - | 1.2 | **Build a route from days and pace.** Given a region, a number of days and a pace, choose trails that join up and fit each day. • Why: This is the product. • Check: A two-day route comes back. • Verified: 26 of 26 route tests pass; a two-day route in the Lakes came back in 0.4 seconds with each day under 7 hours. | A two-day route comes back with each day inside the chosen pace |
| 1.4 | START | agent | code | L | - | 1.3 | **Show the route on a map.** Draw each day in its own colour, with distance, climb and time beside it. • Why: People judge a route by seeing it. • Step: 1 map, 2 day colours, 3 the side panel, 4 phone layout, 5 checks in a browser, 6 publish. • Check: The route is readable on a phone. | The route is readable on a phone, each day in its own colour |
| 1.5 | BACKLOG | agent | code | S | - | 1.3 | **Write the packing list.** Turn the days, the season and the climb into a list of what to carry. • Why: It is the second thing people ask for after the route. • Check: A winter route lists warm layers. | A winter route lists warm layers and a summer route does not |
| 1.6 | BACKLOG | human | account | Q | - | 1.3 | **Choose the weather service.** Pick which weather service the planner asks, and create its account. • Why: Only the owner can accept its terms and its price. • Step: Compare the two services named in the notes, open an account with one, and put its key in the secret store. • Check: The service is named. | The service is named in the settings and its key is in the secret store |

## GOAL 2 — People can find it

### Phase 2 · Going live

Ends with: a stranger can reach the site and sign up

| ID | ST | OWN | TYPE | EFF | GATE | DEPS | Card | DONE-WHEN |
|---|---|---|---|---|---|---|---|---|
| 2.1 | DONE | agent | code | S | - | 1.1 | **Add sign-up by email.** A visitor leaves an email address and gets one confirmation message. • Why: We need a way to tell people when it opens. • Check: A test address gets the message. • Verified: A test address received one confirmation message; a second sign-up with the same address was refused. | A test address gets one confirmation message |
| 2.2 | BACKLOG | human | account | Q | money | 2.1 | **Buy the domain.** Register trailhead.example for one year. • Why: A real address is what people remember and share. • Step: Press Approve on this card, then register the address at the registrar. • Check: The address is ours. | The address is registered in our name |
| 2.3 | BACKLOG | agent | config | S | - | 2.2, 1.4 | **Put the site on its address.** Deploy the app and point the address at it. • Why: Nothing counts until a stranger can open it. • Check: The address opens the site. | The address opens the site over a secure connection |
| 2.4 | BLOCKED | agent | content | S | - | 2.1 | **Write the privacy page.** Say what is stored and for how long. • Why: Sign-up stores an email address, so the page is owed before launch. • Check: The page is linked from sign-up. • Note: Blocked: it needs the name of the company that owns the site, which only the owner knows. | The page is linked from the sign-up form |
| 2.5 | BACKLOG | agent | content | S | - | 2.3 | **Write the launch post.** One page that says what Trailhead does, with a route as the picture. • Why: The first visitors come from one post. • Check: The post reads cleanly to someone who has never seen the site. | The post is published and links to the site |

## GOAL 3 — We know it works

### Phase 3 · Learn

Ends with: a number that says whether people finish a plan

| ID | ST | OWN | TYPE | EFF | GATE | DEPS | Card | DONE-WHEN |
|---|---|---|---|---|---|---|---|---|
| 3.1 | BACKLOG | agent | code | S | - | 2.3 | **Count finished plans.** Record, without names, each time a route is shown. • Why: It is the one number that says the product works. • Check: A test plan is counted once. | A test plan is counted once |
| 3.2 | BACKLOG | agent | verify | S | - | 3.1 | **Find where people give up.** Compare how many start a plan with how many finish, step by step. • Why: The biggest drop is the next thing to fix. • Check: The steps are listed with their numbers. | Each step is listed with how many reached it |
| 3.3 | BACKLOG | human | decision | Q | - | 3.2 | **Decide what to build next.** Read the numbers and choose the next goal. • Why: The plan after launch should come from what people did. • Step: Read the list from card 3.2 and write the next goal as one line. • Check: The next goal is written down. | The next goal is written in the plan |

## Decisions

| Date | Decision | Why |
|---|---|---|
| 2 June | Three regions at launch, not the whole country | Good data for three beats thin data for thirty |
| 4 June | Sign-up by email only | No passwords to keep safe before there is anything to protect |

## Where this stands right now

| | |
|---|---|
| **Live** | Not yet |
