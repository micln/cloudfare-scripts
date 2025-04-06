const index = {
  async fetch(request, env, _ctx) {
    const url = new URL(request.url);

    // Handle robots.txt
    if (url.pathname === "/robots.txt") {
      return new Response("User-agent: *\nDisallow: /", { status: 200 });
    }

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    // Get the target domain and path
    const path = url.pathname.substring(1); // Remove leading slash
    if (!path) {
      return new Response("Please specify a target URL path", {
        status: 400,
        headers: { "content-type": "text/plain;charset=utf-8" }
      });
    }

    // TODO remove leading 'http://' or 'https://'
    if (path.startsWith('http://') || path.startsWith('https://')) {
      path = path.substring(path.indexOf('://') + 3);
    }

    // Use the same protocol as the original request
    const protocol = url.protocol;

    // Construct target URL
    const targetUrl = new URL(`${protocol}//${path}`);
    targetUrl.search = url.search; // Preserve query parameters

    // Get proxy host from request
    const proxyHost = url.host;

    // Create new request headers with necessary modifications
    const headers = new Headers();

    // 复制原始请求的必要头部，但排除一些特定头部
    for (const [key, value] of request.headers.entries()) {
      // 转换为小写以进行不区分大小写的比较
      const lowercaseKey = key.toLowerCase();

      // 跳过这些头部
      if ([
        'referer',
        'origin',
        'sec-fetch-site',
        'sec-fetch-mode',
        'sec-fetch-dest',
        'sec-ch-ua',
        'sec-ch-ua-mobile',
        'sec-ch-ua-platform',
        'proxy-authorization',
        'proxy-connection',
        'forwarded',
        'x-forwarded-for',
        'x-forwarded-host',
        'x-forwarded-proto',
        'via'
      ].includes(lowercaseKey)) {
        continue;
      }

      headers.set(key, value);
    }

    // 设置必要的头部
    headers.set("Host", targetUrl.host);

    // 如果是资源请求，设置一个看起来合理的 Referer
    const contentType = request.headers.get('accept');
    if (contentType && !contentType.includes('text/html')) {
      headers.set("Referer", `${protocol}//${targetUrl.host}/`);
    }

    const newRequestInit = {
      method: request.method,
      headers,
      redirect: "manual",
      body: request.body
    };
    const newRequest = new Request(targetUrl.toString(), newRequestInit);

    try {
      const response = await fetch(newRequest);

      // Log non-200 responses
      if (response.status !== 200) {
        console.log({
          timestamp: new Date().toISOString(),
          url: targetUrl.toString(),
          status: response.status,
          statusText: response.statusText,
          method: request.method,
          clientIP: request.headers.get('cf-connecting-ip'),
          userAgent: request.headers.get('user-agent'),
          referer: request.headers.get('referer')
        });
      }

      const newHeaders = new Headers(response.headers);

      // Handle redirect location
      if (newHeaders.has("location")) {
        const location = newHeaders.get("location");
        try {
          // 如果是完整的 URL
          if (location.startsWith('http://') || location.startsWith('https://')) {
            const locationUrl = new URL(location);
            newHeaders.set("location", `${protocol}//${proxyHost}/${locationUrl.host}${locationUrl.pathname}${locationUrl.search}`);
          }
          // 如果是以 / 开头的相对路径
          else if (location.startsWith('/')) {
            newHeaders.set("location", `${protocol}//${proxyHost}/${targetUrl.host}${location}`);
          }
          // 其他情况保持不变
        } catch (e) {
          console.error('Error processing redirect:', e);
        }
      }

      // Set CORS headers for all responses
      newHeaders.set("access-control-expose-headers", "*");
      newHeaders.set("access-control-allow-origin", "*");
      newHeaders.set("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
      newHeaders.set("access-control-allow-headers", "*");

      // Remove security headers that might cause issues
      newHeaders.delete("content-security-policy");
      newHeaders.delete("content-security-policy-report-only");
      newHeaders.delete("clear-site-data");

      // Remove any existing CORS restrictions
      newHeaders.delete("access-control-allow-origin-list");
      newHeaders.delete("access-control-allow-credentials");
      newHeaders.delete("access-control-request-headers");
      newHeaders.delete("access-control-request-method");
      newHeaders.delete("origin");

      // Handle HTML content
      if (response.headers.get("content-type")?.includes("text/html")) {
        let body = await response.text();

        const targetHost = targetUrl.host;

        // Replace absolute URLs with our proxy URLs
        body = body.replace(
          new RegExp(`https?://${targetHost}/`, 'g'),
          `${protocol}//${proxyHost}/${targetHost}/`
        );

        // Replace relative URLs that start with / (but not //)
        body = body.replace(
          /(?<=(?:href|src|action)=["'])\/((?!\/)[^"']+)["']/g,
          (match, p1) => `${protocol}//${proxyHost}/${targetHost}/${p1}"`
        );

        // Handle base tag
        body = body.replace(
          /<base\s+href=["']\//i,
          `<base href="${protocol}//${proxyHost}/${targetHost}/`
        );

        return new Response(body, {
          status: response.status,
          headers: newHeaders
        });
      }

      return new Response(response.body, {
        status: response.status,
        headers: newHeaders
      });
    } catch (error) {
      // Log errors
      console.error({
        timestamp: new Date().toISOString(),
        url: targetUrl.toString(),
        error: error.message,
        method: request.method,
        clientIP: request.headers.get('cf-connecting-ip'),
        userAgent: request.headers.get('user-agent'),
        referer: request.headers.get('referer')
      });

      return new Response(`Proxy error: ${error.message}`, {
        status: 500,
        headers: { "content-type": "text/plain;charset=utf-8" }
      });
    }
  }
};

export { index as default };
