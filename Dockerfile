# Build stage
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Native build dependencies for prismarine-viewer screenshot support
RUN apt-get update && apt-get install -y --no-install-recommends \
  git \
  python3 \
  python-is-python3 \
  make \
  g++ \
  pkg-config \
  libcairo2-dev \
  libpango1.0-dev \
  libjpeg-dev \
  libgif-dev \
  librsvg2-dev \
  mesa-common-dev \
  libgl1-mesa-dev \
  libglu1-mesa-dev \
  libglew-dev \
  libosmesa6-dev \
  libegl1-mesa-dev \
  libgles2-mesa-dev \
  freeglut3-dev \
  libxi-dev \
  libxext-dev \
  libx11-dev \
  && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install

# Optional native dependency for screenshot capture tool
RUN npm install https://github.com/PrismarineJS/node-canvas-webgl/archive/refs/heads/master.tar.gz

# Copy source
COPY src ./src

# Build TypeScript
RUN npm run build

# Keep only production deps for runtime image
RUN npm prune --omit=dev

# Production stage
FROM node:22-bookworm-slim AS runner

WORKDIR /app

# Runtime libs for node-canvas-webgl/canvas stack
RUN apt-get update && apt-get install -y --no-install-recommends \
  xauth \
  libcairo2 \
  libpango-1.0-0 \
  libjpeg62-turbo \
  libgif7 \
  librsvg2-2 \
  xvfb \
  mesa-utils \
  libosmesa6 \
  libgl1 \
  libglx-mesa0 \
  libgl1-mesa-dri \
  libglapi-mesa \
  libglu1-mesa \
  libegl1 \
  libgles2 \
  libxi6 \
  libxext6 \
  libx11-6 \
  && rm -rf /var/lib/apt/lists/*

ENV LIBGL_ALWAYS_SOFTWARE=1
ENV MESA_GL_VERSION_OVERRIDE=3.3
ENV MESA_GLSL_VERSION_OVERRIDE=330

# Copy built files and production dependencies from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Start Xvfb manually and run MCP server on DISPLAY :99
ENTRYPOINT ["sh", "-c", "Xvfb :99 -ac -screen 0 1280x1024x24 -nolisten tcp & export DISPLAY=:99 && exec node dist/index.js"]
