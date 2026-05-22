# Zen Stock Prophet Design System (SaaS "Vercel/Stripe" Edition)

This system is inspired by world-class developer tools to ensure high precision, readability, and a premium developer-focused aesthetic.

## 1. Visual Theme
- **Base Style**: High-fidelity dark mode with a focus on depth and subtle borders.
- **Brand Feeling**: Precise, Secure, and High-Performance.
- **Aesthetic**: Minimalist with subtle glows and crisp typography.

## 2. Color Palette
- **Backgrounds**:
  - `Base`: `#000000`
  - `Surface`: `#0a0a0a` (Vercel-style) or `#0d1117`
  - `Hover`: `#1a1a1a`
- **Accents**:
  - `Primary (Action)`: `#0070f3` (Vercel Blue) or `#635bff` (Stripe Purple)
  - `Success (Bullish)`: `#00dfd8` (Hyper-cyan) or `#10b981`
  - `Warning (Bearish)`: `#ff4d4d` or `#ef4444`
- **Borders**:
  - `Standard`: `rgba(255, 255, 255, 0.1)`
  - `Faint`: `rgba(255, 255, 255, 0.05)`

## 3. Typography
- **Primary Sans**: `Inter`, system-ui, sans-serif.
- **Headlines**: `Outfit` or `Inter` (Bold/Tight tracking).
- **Monospace (Data)**: `JetBrains Mono` or `Inconsolata`.
- **Principles**:
  - High contrast for labels.
  - Generous line-height for readability.
  - Tight tracking on large headings to feel "Modern SaaS".

## 4. Components & Layout
- **Cards (Glassmorphism Lite)**: 
  - Background: `rgba(10, 10, 10, 0.7)` 
  - Backdrop Filter: `blur(20px)`
  - Border: `1px solid rgba(255, 255, 255, 0.1)`
- **Buttons**:
  - `Primary`: Solid background, white text, no gradient, 6px border-radius.
  - `Ghost`: Transparent, subtle border, strong hover effect.
- **Grid System**: 
  - Use `display: grid` or `flex` with defined constraints. 
  - **NEVER allow interactive elements (buttons) to span the full width of the screen unless explicitly centered in a container.**

## 5. Spacing & Elevation
- **Spacing Units**: 4px, 8px, 16px, 24px, 32px, 48px, 64px.
- **Elevation**: Use subtle box-shadows or border glows instead of heavy gradients.

## 6. Chart Guidelines
- **Lines**: Smooth Bezier or sharp distinct paths.
- **Glow**: Subtle neon outer-glow for priority data lines.
- **Fills**: Low-opacity gradients under primary lines.

## 7. Responsiveness
- Desktop-first, collapsing to single-column on mobile.
- Use `max-width: 1200px` for main content area to prevent horizontal stretching.
