# Frontend Redesign — Phase 5 Completion: Dark Mode Activation + Base UI Button Fixes

**Plan:** unplanned post-Phase-4 runtime fixes (see §6 — displaces the planned doc-only Phase 5)
**Status:** Shipped
**Diff (3 files, +3 / -0 net):**
- `frontend/src/app/layout.tsx` — `dark` class added to `<html>` (+1 string token)
- `frontend/src/components/app-top-bar.tsx` — `nativeButton={false}` on `DropdownMenuTrigger` (+1 prop)
- `frontend/src/components/ui/sidebar.tsx` — `nativeButton={false}` on `TooltipTrigger` in `SidebarMenuButton` (+1 prop)

---

## 1. What shipped

Two independent bugs surfaced on first boot post-Phase-4. Both are
single-prop fixes. Phase 5 closes them together because they appeared
simultaneously and are the last barriers between the redesign work and
a correctly rendered, warning-free UI.

---

## 2. Dark mode was never activated

### 2.1 The gap

`globals.css` contains a `.dark {}` block that redefines every design
token — background, foreground, card, sidebar, and all other CSS vars —
to the dark pearlescent palette. Without a `dark` class on `<html>`, the
browser applies only the `:root {}` block: a standard white/light-gray
shadcn theme. Every Phases 1–4 visual — the pearl gradient, halftone
substrate, chrome buttons, dark sidebar — is invisible in light mode
because those surfaces have zero contrast against a white background.

The comment in `globals.css` states this explicitly:

```css
/* Tuned dark-first; light mode is not a v1 product target. */
```

The omission was not caught in Phases 1–4 because the validation matrix
checked `pnpm build` and HTTP 200 responses, not visual rendering.

### 2.2 The fix

```diff
  <html
    lang="en"
-   className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
+   className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
  >
```

**Why static, not dynamic.** v1 has no theme toggle (stack.md §13
"No dark mode beyond whatever shadcn gives us for free"). Adding `dark`
statically to `<html>` is the correct v1 approach: the design system
token split (`:root` vs `.dark`) already exists, and this is the switch
that activates it. A future `next-themes`-based toggle would swap the
class at runtime without touching the CSS variables themselves.

**Why here and not a cookie / server component.** The `layout.tsx` is a
React Server Component — the `dark` class is injected into the HTML
shell during server render. No flash-of-wrong-theme on page load; the
initial HTML already carries the class before any JS executes.

---

## 3. Base UI `nativeButton` console warnings

### 3.1 The error

```
Base UI: A component that acts as a button expected a native <button>
because the `nativeButton` prop is true. Rendering a non-<button>
removes native button semantics, which can impact forms and accessibility.
Use a real <button> in the `render` prop, or set `nativeButton` to `false`.
```

Fired from `useButton.useEffect` (Base UI internals) on every page mount
that renders the top-bar avatar trigger or a sidebar nav item with a
tooltip.

### 3.2 How `nativeButton` works

Base UI's `useButton` hook inspects the `render` prop's React element
**type** — the JSX tag string — to decide whether native `<button>`
semantics are already present. The check is:

```js
if (nativeButton && elementType !== "button") {
  console.error(...)
}
```

The type check happens at the React element level, not the DOM level.
Passing `render={<Button>}` gives type `Button` (a function reference),
not `"button"` (the literal string). Even though `Button` ultimately
renders a `<button>` DOM element, the check fires because it never
reaches the DOM.

When `nativeButton={false}`, Base UI stops assuming native semantics and
instead injects `role="button"` + keyboard handlers itself — correct
behaviour for a render-prop scenario where the root element may or may
not be a native button.

### 3.3 Site 1 — `DropdownMenuTrigger` in `app-top-bar.tsx`

```diff
  <DropdownMenuTrigger
+   nativeButton={false}
    render={
      <Button variant="ghost" size="icon" className="rounded-full">
        <Avatar className="size-7">
          <AvatarFallback className="text-xs">
            {initials(userName, email)}
          </AvatarFallback>
        </Avatar>
      </Button>
    }
  />
```

`Button` is a React component (wraps `ButtonPrimitive` from
`@base-ui/react/button`), so `elementType` is `Button`, not `"button"`.
Adding `nativeButton={false}` suppresses the check. The rendered DOM
element is still a genuine `<button>` — `nativeButton={false}` only
tells Base UI not to assume it, not to prevent it.

### 3.4 Site 2 — `TooltipTrigger` in `sidebar.tsx` `SidebarMenuButton`

```diff
  render: !tooltip
    ? render
-   : <TooltipTrigger render={render} />,
+   : <TooltipTrigger nativeButton={false} render={render} />,
```

When a sidebar nav item has a `tooltip` prop (which every item does in
the collapsed icon state), `SidebarMenuButton` wraps the caller-supplied
`render` element inside `<TooltipTrigger>`. The `render` element in
`app-sidebar.tsx` is `<Link href={...}>` — a Next.js link that renders
an `<a>`, not a `<button>`. `TooltipPrimitive.Trigger` defaults to
`nativeButton={true}`, so the check fires on every sidebar item render
when the sidebar is in collapsed/tooltip mode.

`nativeButton={false}` is unconditionally correct here: `SidebarMenuButton`
accepts arbitrary render elements (the component's type is
`useRender.ComponentProps<"button">`) — callers may pass links, divs, or
custom components. The tooltip trigger must not assume native button
semantics for elements it cannot inspect.

---

## 4. Relationship to the planned Phase 5

Phase 4's §9 "Hand-off to Phase 5" described Phase 5 as **doc-only** —
a rewrite of `docs/refs/design-system.md` to reflect Phases 1–4's
shipped state. No FE code changes were anticipated.

The dark-mode gap and the Base UI warnings are runtime correctness
issues that cannot wait for a doc-only pass. This phase lands the code
fixes and displaces the design-system.md rewrite to **Phase 6**. The
Phase 4 hand-off items (§4 Phase 4, points 1–5 + reconciliation list)
are still owed and move intact to Phase 6.

---

## 5. Files touched

```
frontend/src/app/layout.tsx                     +1 / -0   (dark class on <html>)
frontend/src/components/app-top-bar.tsx         +1 / -0   (nativeButton={false})
frontend/src/components/ui/sidebar.tsx          +1 / -0   (nativeButton={false})
                                                ─────────
                                                3 files, +3 net LOC
```

---

## 6. Hand-off to Phase 6

Phase 6 is the design-system.md doc rewrite originally planned for Phase 5.
All five items from Phase 4's §9 hand-off list carry forward unchanged:

1. Pearl/halftone material vocabulary — Phase 1's CSS tokens + classes.
2. Pearl variant on `Button` — replace §13.1's "Primary Button" example.
3. Two-material model — explicit substrate vs chrome table.
4. Departures Phases 1–4 took from the plan's literal sketches.
5. `<TerminalContainer>` + `<StatusDot>` ship-without-consumer note.

Plus one addition from this phase:
- **Dark mode activation** — document that `dark` on `<html>` is the
  switch, `next-themes` is the v1.5 path for a toggle, and the v1
  static approach is intentional.
