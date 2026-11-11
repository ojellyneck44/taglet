# Design

The source of truth is [docs/brand.md](docs/brand.md) (palette, type, icon, glass, motion, voice). The tokens are in `public/css/base.css`.

Quick rules:

- Dark warm inks, one themeable accent (Manila by default), and Signal only for problems.
- Bricolage Grotesque for display, Hanken Grotesk for interface text, JetBrains Mono for data only.
- Glass only on the floating control layer. Content is solid. Album art lights the room behind the glass.
- Lists, not card grids. Album art at 5px radius, fields at 9px, buttons and bars as capsules.
- Motion: the tag on a string, plus View Transitions between screens. Respect Reduce Motion.
- Every control is at least 44px. Focus rings use the accent. Text contrast is at least 4.5:1.
