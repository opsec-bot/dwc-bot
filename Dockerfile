FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json (if available)
COPY package.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of the code
COPY . .

# Build TypeScript
RUN npx esbuild src/index.ts --bundle --platform=node --outdir=dist --target=node18 --external:@angablue/exe --external:pkg --external:sqlite3 --tsconfig=tsconfig.json

# Expose port (if your bot uses a web server, e.g., Express)
# ENV PORT=80
# EXPOSE 80

# Start the bot
CMD ["node", "dist/index.js"]
# Install Python 3, pip, and venv
RUN apk add --no-cache python3 py3-pip py3-virtualenv

# Create a virtual environment and install Python dependencies
RUN python3 -m venv /app/venv \
    && . /app/venv/bin/activate \
    && pip install --upgrade pip \
    && pip install -r requirements.txt

# Ensure venv is activated for all future RUN/CMD/ENTRYPOINT
ENV PATH="/app/venv/bin:$PATH"
