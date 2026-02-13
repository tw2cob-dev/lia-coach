This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Clipboard Screenshot Helper (Windows)

Save an image from the Windows clipboard and generate a Codex image tag:

```bash
npm run clip
```

What it does:
- Saves the screenshot in `tmp/clipboard/`.
- Prints a tag like `<image path="C:\...\screenshot-YYYYMMDD-HHMMSS.png">`.
- Copies that tag to clipboard, ready to paste in Codex CLI.

### Ctrl+V Only Mode (automatic)

Run once to start a background agent:

```bash
npm run clip:agent:start
```

Check if it is alive:

```bash
npm run clip:agent:status
```

If Ctrl+V stops working, recover automatically:

```bash
npm run clip:agent:restart
```

Optional: auto-start on Windows login:

```bash
npm run clip:agent:install
```

How it works:
- When clipboard contains an image, it saves it to `tmp/clipboard/`.
- It also puts a text tag `<image path="...">` into clipboard (keeping bitmap data).
- In Codex CLI, use `Ctrl+V` directly.
- Auto-delete is enabled by default: removes files older than 7 days and keeps only the latest 80 screenshots.

Stop the agent:

```bash
npm run clip:agent:stop
```

### Quick Troubleshooting

Useful commands when `Ctrl+V` is intermittent:

```bash
npm run clip:agent:status
```

Checks whether the background clipboard agent is running and shows the latest saved screenshot.

```bash
npm run clip:agent:restart
```

Stops and starts the agent again to recover clipboard tagging quickly.
