# QA checklist outline

One file per project, `qa-checklist.md`, run end to end before launch and again after the launch settings are flipped. Each item is a checkbox with the person who ran it and the date.

0. **Pre-flight.** Preview environment, domain and SSL, every setting in its launch state, legal pages and policies, robots and indexing.
1. **Devices.** iOS Safari and Chrome, Instagram and Facebook in-app browsers on iOS and Android, Android Chrome, a tablet, desktop Safari, Chrome, Firefox and Edge. On each: no horizontal scroll, 44px touch targets, safe areas, pinch zoom.
2. **One section per ticket.** Its acceptance criteria as checks, every state (empty, sold out, ended, error), and the merchant settings it promises.
3. **Forms and email, payments, shipping**, when in scope, each with one real run.
4. **Performance, accessibility, SEO.** LCP, CLS and INP with measured numbers and the tool that measured them; keyboard and screen-reader pass; titles, descriptions, social cards.
5. **Launch flip.** What changes on launch day, who flips it, when.

A check that was reasoned about rather than seen is marked "verified by logic, not live" and stays open until someone sees it.
