import type { Params } from 'nestjs-pino';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * nestjs-pino 配置。dev:pretty 控制台 + app.log(全量)+ error.log(error+)。
 * prod:仅文件。均经 pino-roll 按天滚动,写到 server/logs/。HTTP 请求自动记录。
 */
export const pinoLoggerOptions: Params = {
  pinoHttp: {
    level: isDev ? 'debug' : 'info',
    autoLogging: {
      ignore: (req) => {
        const url = (req as { url?: string }).url ?? '';
        return url.endsWith('/health');
      },
    },
    transport: isDev
      ? {
          targets: [
            {
              target: 'pino-pretty',
              level: 'info',
              options: {
                colorize: true,
                translateTime: 'SYS:HH:MM:ss.l',
                ignore: 'pid,hostname',
              },
            },
            {
              target: 'pino-roll',
              level: 'info',
              options: {
                file: 'logs/app.log',
                frequency: 'daily',
                mkdir: true,
              },
            },
            {
              target: 'pino-roll',
              level: 'error',
              options: {
                file: 'logs/error.log',
                frequency: 'daily',
                mkdir: true,
              },
            },
          ],
        }
      : {
          targets: [
            {
              target: 'pino-roll',
              level: 'info',
              options: {
                file: 'logs/app.log',
                frequency: 'daily',
                mkdir: true,
              },
            },
            {
              target: 'pino-roll',
              level: 'error',
              options: {
                file: 'logs/error.log',
                frequency: 'daily',
                mkdir: true,
              },
            },
          ],
        },
  },
};
