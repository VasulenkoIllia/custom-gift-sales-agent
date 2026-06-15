# INTELLECT support bot — runs the Node/TS app via tsx (no build step).
FROM node:20-slim

WORKDIR /app

# Install all deps (tsx + typescript are needed at runtime to run the .ts entry).
COPY package.json package-lock.json ./
RUN npm ci --include=dev && npm cache clean --force

# App source
COPY . .

ENV NODE_ENV=production
EXPOSE 3000

# package.json "start": node --env-file-if-exists=.env --import tsx src/index.ts
# In Docker, env comes from compose env_file, so the missing .env is fine.
CMD ["npm", "start"]
