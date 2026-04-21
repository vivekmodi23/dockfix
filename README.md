# dockfix

`dockfix` is a CLI that detects common Node.js project types and generates a Docker setup, then optionally builds/runs to validate.

## Supported project types

- Next.js
- NestJS
- Express
- Fastify
- Vite (static build served by nginx)
- Generic Node.js (fallback)

## Install

Global:

```bash
npm install -g dockfix
```

One-off with `npx`:

```bash
npx dockfix init .
```

## Usage

Generate Docker files in current repo:

```bash
dockfix init .
```

Clone or update repo, generate Dockerfile, build, and run:

```bash
dockfix clone https://github.com/<owner>/<repo>.git
```

Use AI Dockerfile refinement loop:

```bash
export OPENAI_API_KEY=your_key
dockfix dockerize-ai .
```

Allow safe config-only fixes during failure handling:

```bash
dockfix clone https://github.com/<owner>/<repo>.git --allow-file-fixes
```

## Publish to npm

1. Log in:

```bash
npm login
```

2. Build:

```bash
npm run build
```

3. Publish:

```bash
npm publish --access public
```

## Local development

```bash
npm install
npm run build
npm link
```

Now `dockfix` is available globally from your local checkout.
