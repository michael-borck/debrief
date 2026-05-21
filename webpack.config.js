const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');

// Webpack passes `--mode production` via argv; default to development.
const IS_PROD = process.argv.includes('--mode=production') ||
                process.argv.includes('production') ||
                process.env.NODE_ENV === 'production';

module.exports = {
  mode: 'development',
  entry: './src/index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',
    clean: true,
  },
  target: 'web', // Change from electron-renderer to web for dev
  cache: false,
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader', 'postcss-loader'],
      },
      {
        // Import .md files as raw strings so we can render them in-app.
        // Used by src/pages/DocsPage to serve the documentation folder.
        test: /\.md$/,
        type: 'asset/source',
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    fallback: {
      "path": false,
      "fs": false,
      "crypto": false,
      "os": false,
      "stream": false,
      "buffer": false,
      "events": false,
      "child_process": false,
      "net": false,
      "tls": false,
      "perf_hooks": false
    }
  },
  externals: {
    '@lancedb/lancedb': 'null'
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './public/index.html',
      // Webpack dev uses eval-source-map (default for `mode: development`),
      // which needs 'unsafe-eval' in the CSP. Production builds don't, so we
      // drop it entirely there — that's what triggered Electron's
      // "Insecure Content-Security-Policy" runtime warning.
      cspEval: IS_PROD ? '' : "'unsafe-eval'",
    }),
    new webpack.DefinePlugin({
      global: 'window',
      // NODE_ENV is intentionally NOT defined here — webpack's `mode` already
      // injects the correct value ('production' for `--mode production`, else
      // 'development'). Defining it manually read the OS env var (unset in the
      // build script), so it injected 'development' into production builds and
      // collided with webpack's own define.
      'process.platform': JSON.stringify(process.platform)
    }),
  ],
  // The renderer ships as one bundle loaded from local disk inside Electron,
  // not fetched over a network — so the default 244 KiB web budget doesn't
  // apply. We still keep a budget (just a realistic one) so a runaway jump in
  // bundle size still surfaces as a warning instead of going unnoticed.
  performance: {
    maxAssetSize: 2_621_440, // 2.5 MiB
    maxEntrypointSize: 2_621_440,
  },
  devServer: {
    static: false,
    compress: true,
    port: 9000,
    hot: true,
    historyApiFallback: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
    devMiddleware: {
      writeToDisk: true,
    },
  },
};