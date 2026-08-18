function propertyName(member) {
  if (member.type !== 'MemberExpression') {
    return undefined;
  }

  if (!member.computed && member.property.type === 'Identifier') {
    return member.property.name;
  }

  if (
    member.computed &&
    member.property.type === 'Literal' &&
    typeof member.property.value === 'string'
  ) {
    return member.property.value;
  }

  return undefined;
}

function isGlobalObject(node, name) {
  if (node.type === 'Identifier') {
    return node.name === name;
  }

  return (
    node.type === 'MemberExpression' &&
    propertyName(node) === name &&
    node.object.type === 'Identifier' &&
    node.object.name === 'window'
  );
}

function isRuntimeGlobal(node) {
  return (
    node.type === 'Identifier' &&
    (node.name === 'globalThis' ||
      node.name === 'self' ||
      node.name === 'window')
  );
}

function staticString(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }

  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked;
  }

  return undefined;
}

const noExtensionAutomation = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Prevents extension code from driving or reading Facebook',
    },
    messages: {
      forbidden:
        'MarketScope generates zero Facebook requests. This extension operation is forbidden.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          banNetwork: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const banNetwork = context.options[0]?.banNetwork === true;
    const report = (node) => context.report({ node, messageId: 'forbidden' });

    return {
      AssignmentExpression(node) {
        if (
          node.left.type === 'MemberExpression' &&
          propertyName(node.left) === 'href' &&
          isGlobalObject(node.left.object, 'location')
        ) {
          report(node);
        }
      },
      CallExpression(node) {
        if (
          banNetwork &&
          ((node.callee.type === 'Identifier' &&
            (node.callee.name === 'fetch' ||
              node.callee.name === 'XMLHttpRequest')) ||
            (node.callee.type === 'MemberExpression' &&
              (propertyName(node.callee) === 'fetch' ||
                propertyName(node.callee) === 'XMLHttpRequest') &&
              isRuntimeGlobal(node.callee.object)))
        ) {
          report(node);
          return;
        }

        if (node.callee.type !== 'MemberExpression') {
          return;
        }

        const method = propertyName(node.callee);
        if (
          method === 'scrollIntoView' ||
          method === 'click' ||
          method === 'dispatchEvent' ||
          (method === 'scrollTo' &&
            isGlobalObject(node.callee.object, 'window')) ||
          (method === 'pushState' &&
            isGlobalObject(node.callee.object, 'history')) ||
          (method === 'assign' &&
            isGlobalObject(node.callee.object, 'location'))
        ) {
          report(node);
        }
      },
      MemberExpression(node) {
        const member = propertyName(node);
        if (
          (member === 'cookie' && isGlobalObject(node.object, 'document')) ||
          (member === 'cookies' && isGlobalObject(node.object, 'chrome'))
        ) {
          report(node);
        }
      },
      NewExpression(node) {
        if (
          banNetwork &&
          ((node.callee.type === 'Identifier' &&
            node.callee.name === 'XMLHttpRequest') ||
            (node.callee.type === 'MemberExpression' &&
              propertyName(node.callee) === 'XMLHttpRequest' &&
              isRuntimeGlobal(node.callee.object)))
        ) {
          report(node);
        }
      },
    };
  },
};

const noGeneratedFacebookClass = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Prevents selectors tied to Facebook generated class names',
    },
    messages: {
      generatedClass:
        'Facebook generated class names are unstable. Use structural, ARIA, href, alt, or visible-text selectors.',
    },
    schema: [],
  },
  create(context) {
    const selectorMethods = new Set([
      'closest',
      'matches',
      'querySelector',
      'querySelectorAll',
    ]);

    return {
      CallExpression(node) {
        if (
          node.callee.type !== 'MemberExpression' ||
          !selectorMethods.has(propertyName(node.callee))
        ) {
          return;
        }

        const selector = staticString(node.arguments[0]);
        if (selector !== undefined && /\.[a-z0-9]{6,}/.test(selector)) {
          context.report({ node, messageId: 'generatedClass' });
        }
      },
    };
  },
};

const noUnsafeHtml = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Requires untrusted strings to render as text nodes',
    },
    messages: {
      unsafeHtml:
        'MarketScope renders listing-derived strings as text nodes. {{property}} is forbidden.',
    },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        const member = propertyName(node);
        if (member === 'innerHTML' || member === 'insertAdjacentHTML') {
          context.report({
            node,
            messageId: 'unsafeHtml',
            data: { property: member },
          });
        }
      },
    };
  },
};

const noEmDash = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Keeps prose consistent with the repository writing style',
    },
    messages: {
      emDash: 'Use a comma, colon, or period instead of an em dash.',
    },
    schema: [],
  },
  create(context) {
    return {
      Program(node) {
        if (context.sourceCode.text.includes('\u2014')) {
          context.report({ node, messageId: 'emDash' });
        }
      },
    };
  },
};

export const marketscopePlugin = {
  rules: {
    'no-em-dash': noEmDash,
    'no-extension-automation': noExtensionAutomation,
    'no-generated-facebook-class': noGeneratedFacebookClass,
    'no-unsafe-html': noUnsafeHtml,
  },
};
