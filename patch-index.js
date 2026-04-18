const fs = require('fs');
const path = require('path');

const filePath = 'D:\\openclaw\\exercise-tracker\\index.html';
let content = fs.readFileSync(filePath, 'utf8');

// Fix 1: The inline </style> tag has CSS text after it on the same line
// Find the pattern: </style> followed by CSS text (not a new <style> tag)
// We need to wrap the following CSS in <style>...</style>
const brokenStylePattern = /<\/style>(\s*<!--.*?-->)?\s*\/\* ====== .*? ====== \*\//;
if (brokenStylePattern.test(content)) {
    // Find the </style> that is followed by CSS (not a new <style> tag)
    // We need to insert a <style> tag after </style> and wrap the following CSS
    const insertPoint = content.indexOf('</style>');
    const afterStyle = content.substring(insertPoint + '</style>'.length);
    // Check if there's a <style> tag right after
    if (!afterStyle.trim().startsWith('<style>')) {
        content = content.substring(0, insertPoint + '</style>'.length) + '\n    <style>' + afterStyle;
        // Find where </head> is and close the style before it
        const headClose = content.lastIndexOf('</head>');
        content = content.substring(0, headClose) + '\n    </style>\n' + content.substring(headClose);
        console.log('Fixed: wrapped orphaned CSS in <style> tag');
    }
}

// Fix 2: Add loading screen HTML div after the globalToast div
const toastDivPattern = /(<div class="toast-notification" id="globalToast">[\s\S]*?<\/div>\s*)\n\n(?!\s*<div id="app">)/;
const loadingScreenHTML = `
    <!-- 初始加载 Splash Screen -->
    <div id="appLoadingScreen">
        <div class="loading-splash-inner">
            <div class="loading-logo">🏃</div>
            <div class="loading-title">运动记录</div>
            <div class="loading-spinner"></div>
            <div class="loading-tip">正在加载...</div>
        </div>
    </div>
`;
if (toastDivPattern.test(content)) {
    content = content.replace(toastDivPattern, `$1\n${loadingScreenHTML}`);
    console.log('Added: loading screen HTML div');
}

// Fix 3: Ensure loading screen CSS is inside a <style> tag in the <head>
// Find the loading screen CSS and make sure it's properly wrapped
// The CSS starts with "#appLoadingScreen {" and should be inside <style> tags
const loadingCSSStart = content.indexOf('    #appLoadingScreen {');
const loadingCSSEnd = content.indexOf('\n</head>', loadingCSSStart);
if (loadingCSSStart !== -1 && loadingCSSEnd !== -1) {
    const beforeLoading = content.substring(0, loadingCSSStart);
    const loadingCSS = content.substring(loadingCSSStart, loadingCSSEnd);
    const afterLoading = content.substring(loadingCSSEnd);
    
    // Check if there's already a <style> before #appLoadingScreen
    const lastStyleOpen = beforeLoading.lastIndexOf('<style>');
    const lastStyleClose = beforeLoading.lastIndexOf('</style>');
    
    if (lastStyleClose > lastStyleOpen) {
        // The <style> is already closed, need to open a new one for loading CSS
        content = beforeLoading + '\n    <style>\n' + loadingCSS + '\n    </style>\n' + afterLoading;
        console.log('Fixed: re-wrapped loading CSS in <style> tag');
    } else {
        console.log('Loading CSS appears to be inside a <style> tag already');
    }
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Done! File written.');

// Verify
const newContent = fs.readFileSync(filePath, 'utf8');
const hasAppLoadingScreen = newContent.includes('id="appLoadingScreen"');
const loadingScreenInBody = newContent.includes('<div id="appLoadingScreen">');
const styleCount = (newContent.match(/<style>/g) || []).length;
const closeStyleCount = (newContent.match(/<\/style>/g) || []).length;
console.log(`Has #appLoadingScreen div: ${hasAppLoadingScreen}`);
console.log(`Loading screen div in body: ${loadingScreenInBody}`);
console.log(`<style> count: ${styleCount}, </style> count: ${closeStyleCount}`);
