# Contributing to Cool Router

Thanks for helping out! Keep changes small and focused.

1. Fork and clone, then `npm install`.
2. Run `npm run dev` and open http://localhost:20128.
3. Before opening a pull request, make sure these pass:

```bash
npm run lint
npm run typecheck:core
npm run test:unit
npm run build
```

Style: use the theme tokens (`bg-primary`, `text-primary-foreground`, `border-border`, `text-text-muted`) instead of hard-coded colours, and keep new UI in the monochrome look.
