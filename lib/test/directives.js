"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var chai_1 = require("chai");
var src_1 = require("../src");
var graphql_tag_1 = require("graphql-tag");
describe('directives', function () {
    it('skips a field that has the skip directive', function () {
        var resolver = function () { throw new Error('should not be called'); };
        var query = (_a = ["\n      {\n        a @skip(if: true)\n      }\n    "], _a.raw = ["\n      {\n        a @skip(if: true)\n      }\n    "], graphql_tag_1.default(_a));
        var result = src_1.default(resolver, query, '', null, null);
        chai_1.assert.deepEqual(result, {});
        var _a;
    });
    it('includes info about arbitrary directives', function () {
        var resolver = function (fieldName, root, args, context, info) {
            var doSomethingDifferent = info.directives.doSomethingDifferent;
            var result = root[info.resultKey];
            if (doSomethingDifferent) {
                if (doSomethingDifferent.but.value === 'notTooCrazy') {
                    return result + " different";
                }
                else {
                    return "<<" + result + ">> incorrect directive arguments";
                }
            }
            return result;
        };
        var input = {
            a: 'something',
        };
        var query = (_a = ["\n      {\n        a @doSomethingDifferent(but: notTooCrazy)\n        b\n      }\n    "], _a.raw = ["\n      {\n        a @doSomethingDifferent(but: notTooCrazy)\n        b\n      }\n    "], graphql_tag_1.default(_a));
        var result = src_1.default(resolver, query, input, null, null);
        chai_1.assert.deepEqual(result, { a: 'something different' });
        var _a;
    });
});
//# sourceMappingURL=directives.js.map