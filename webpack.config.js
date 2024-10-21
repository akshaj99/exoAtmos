import path from 'path';
import { fileURLToPath } from 'url';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import CopyPlugin from 'copy-webpack-plugin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
    mode: 'development',
    entry: './src/index.js',
    output: {
        filename: 'bundle.js',
        path: path.resolve(__dirname, 'public'),
        clean: {
            keep: /images\//,
        },
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: ['@babel/preset-env'],
                    },
                },
            },
            {
                test: /\.(png|svg|jpg|jpeg|gif)$/i,
                type: 'asset/resource',
            },
        ],
    },
    resolve: {
        extensions: ['.js'],
        alias: {
            'three': path.resolve('./node_modules/three')
        }
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: 'public/index.html',
            inject: 'body',
            scriptLoading: 'defer'
        }),
        new HtmlWebpackPlugin({
            template: 'public/index.html',
            inject: 'body',
            scriptLoading: 'defer'
        }),
        new CopyPlugin({
            patterns: [
                { from: 'public/images', to: 'images' }
            ],
        }),
    ],
    devServer: {
        static: path.resolve(__dirname, 'public'),
        port: 3000,
        hot: false,
        devMiddleware: {
            writeToDisk: true,
        },
    },
};