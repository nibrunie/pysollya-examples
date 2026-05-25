# -*- coding: utf-8 -*-

# this script requires pysollya
# install pysollya:
#     pip install git+https://github.com/nibrunie/pysollya.git@v0.1.1

from pysollya import SollyaObject, round_sol, floor_sol, log2, RN, halfprecisionformat, singleformat
import random
import statistics

import matplotlib.pyplot as plt
    

# evaluation scheme
# - how is every product rounded ?
# - how is every product aligned ?
# - how is every product accumulated ?
#
# This experiment relies on using numerical value with lazy evaluations:
# the expression should not be evaluated before an explicit round function is called
# (which indicates the exact places where actual rounding should be performed).
# pysollya.SollyaObject fulfills those requirements.

def correctlyRoundedDotProd(a, b, resPrec=singleformat):
    """ correctly rounded dot product of n-element arrays a and b to precision @p resPrec

        there is no intermediate rounding.
         Accumulation of products is perfomed exactly and finally rounded """
    prods = [ai * bi for (ai, bi) in zip(a, b)]
    s = SollyaObject(0.0)
    for p in prods:
        s += p
    # final rounding
    return round_sol(s, resPrec, RN)

def approxMultDotProd(a, b, multPrec=halfprecisionformat, resPrec=singleformat):
    """ dot product of n-element arrays a and b
        each product is first rounded towards @p multPrec before being exactly
        accumulated and finally rounded """
    prods = [round_sol(ai * bi, multPrec, RN) for (ai, bi) in zip(a, b)]
    return round_sol(sum(prods, SollyaObject(0)), resPrec, RN)

def approxMultDotProd_FP16_FP32(a, b):
    return approxMultDotProd(a, b, halfprecisionformat, singleformat)

def approxMultDotProd_FP32_FP32(a, b):
    return approxMultDotProd(a, b, singleformat, singleformat)

def approxMultAccDotProd(a, b, multPrec=halfprecisionformat, addPrec=halfprecisionformat, resPrec=singleformat):
    """ dot product of n-element arrays a and b
        each product is first rounded towards @p multPrec before being accumulated
        with a binary tree of addition (rounded to addPrec each time) before being
        eventually finally rounded """
    prods = [round_sol(ai * bi, multPrec, RN) for (ai, bi) in zip(a, b)]
    def binAddTree(v):
        if len(v) == 1:
            return v
        evenOps = v[0::2]
        oddOps  = v[1::2] 
        addRes = [round_sol(ai + bi, addPrec, RN) for (ai, bi) in zip(evenOps, oddOps)] + ([v[-1]] if len(v) % 2 == 1 else [])
        return binAddTree(addRes)
    result = binAddTree(prods)[0]
    return round_sol(result, resPrec, RN)

def roundToOddFixed(v, lsbIndex=0):
    """ rounding-to-odd (jamming inexact value) for fixed-point """
    sign = v < 0
    v = abs(v)
    scalingFactor = SollyaObject(2) ** (-lsbIndex)
    try:
        scaled = int(v * scalingFactor)
    except ValueError as e:
        print(v)
        raise
    notExact = (scaled / scalingFactor) != v
    rounded = scaled | (1 if notExact else 0)
    return (-1 if sign else 1) * rounded / scalingFactor

def roundToOdd(v, prec: int, emin = None):
    """ rounding-to-odd (jamming inexact value) for floating-point """
    sign = v < 0
    v = abs(v)
    # zero value will overflow log2 in magnitude and must be
    # handled separately
    if v == 0:
        return 0
    exp = floor_sol(log2(abs(v)))
    if emin:
        exp = max(exp, emin)
    preScalingFactor = SollyaObject(2) ** (- exp)
    preScaled = v * preScalingFactor
    return (-1 if sign else 1) * roundToOddFixed(preScaled, -prec) / preScalingFactor


class ExactFormat:
    def __init__(self):
        pass

    @staticmethod
    def exponent(value):
        return floor_sol(log2(abs(value)))

class IEEEFormat:
    def __init__(self, expSize, sigSize):
        """
        IEEE floating point format.
        expSize: number of bits for the exponent
        sigSize: number of bits for the significand (including the implicit leading 1 for normal numbers)
        """
        self.expSize = expSize
        self.sigSize = sigSize

    @property
    def emin(self):
        return -(2 ** (self.expSize - 1) - 1)

    def exponent(self, value):
        realExp = floor_sol(log2(abs(value)))
        return max(realExp, self.emin)


def bulkNormDotProd(a, b, bulkNormPrec=25, finalPrec=24, prodFormats=(ExactFormat(), ExactFormat())):
    """ Bulk normalization dot product with reference product exponent """
    prods = [ai * bi for (ai, bi) in zip(a, b)]
    # evaluating exponent of products
    # this implementation does not consider the denormalization of subnormal product operands
    # this could work by limiting the minimum exponent
    # def ieeeExp
    lhsFormat, rhsFormat = prodFormats
    # prodExps = [floor_sol(log2(abs(ai))) + floor_sol(log2(abs(bi))) for (ai, bi) in zip(a, b)]
    prodExps = [lhsFormat.exponent(ai) + rhsFormat.exponent(bi) for (ai, bi) in zip(a, b)]
    maxExp = max(prodExps)

    # emulating bulk normalization of the products
    roundedProds = [roundToOddFixed(p, maxExp - bulkNormPrec) for p in prods]
    # accumulation and final rounding
    return roundToOdd(sum(roundedProds), finalPrec)

def bulkNormDotProd_fixed30_FP32(a, b, prodFormats=(ExactFormat(), ExactFormat())):
    return bulkNormDotProd(a, b, 30, 24, prodFormats)

def bulkNormDotProd_fixed25_FP32(a, b, prodFormats=(ExactFormat(), ExactFormat())):
    return bulkNormDotProd(a, b, 25, 24, prodFormats)

def bulkNormDotProd_fixed20_FP32(a, b, prodFormats=(ExactFormat(), ExactFormat())):
    return bulkNormDotProd(a, b, 20, 24, prodFormats)

def bulkNormDotProd_fixed15_FP32(a, b, prodFormats=(ExactFormat(), ExactFormat())):
    return bulkNormDotProd(a, b, 15, 24, prodFormats)

def bulkNormDotProd_fixed10_FP32(a, b, prodFormats=(ExactFormat(), ExactFormat())):
    return bulkNormDotProd(a, b, 10, 24, prodFormats)

import argparse

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate normalization schemes for dot products")
    parser.add_argument("n", type=int, nargs="?", default=10000)
    parser.add_argument("--average", type=float, default=5.0, help="Average value for the random vectors")
    parser.add_argument("--sigma", type=float, default=5.0, help="Standard deviation for the random vectors")
    parser.add_argument("--k", type=int, default=2, help="Dot product dimension")
    parser.add_argument("--out", type=str, default="plot.png", help="Output file for the plot") 

    args = parser.parse_args()

    fig = plt.figure()
    ax = plt.subplot(111)

    for _ in range(1):
        n = args.n
        average = args.average
        sigma = args.sigma
        k = args.k
        input_prec = halfprecisionformat
        def genVector(k):
            return [round_sol(random.gauss(average, sigma), input_prec, RN) for _ in range(k)]
        v = [(genVector(k), genVector(k)) for _ in range(n)]


        def evaluateErrors(v, func, golden_values):
            abs_errors = []
            rel_errors = []
            for ((a, b), golden) in zip(v, golden_values):
                res = func(a, b)
                abs_error = abs(res - golden)
                rel_error = abs(abs_error / golden)
                abs_errors.append(float(abs_error))
                rel_errors.append(float(rel_error))
            return abs_errors, rel_errors

        def cancellationMetric(v):
            sum = 0
            max_exp = None
            for (a, b) in zip(v[0], v[1]):
                prod = a * b
                prod_exp = ExactFormat.exponent(prod)
                max_exp = prod_exp if max_exp is None else max(max_exp, prod_exp)
                sum += a * b
            sum_exp = ExactFormat.exponent(sum)
            return max_exp - sum_exp
            

        # selecting how the golden value is evaluated
        reference = correctlyRoundedDotProd

        golden_values = [reference(a, b) for (a, b) in v]

        for (label, func) in [
            # ("correctRounding", correctlyRoundedDotProd),
            ("bulkNormDotProd [Fixed10, FP32]", bulkNormDotProd_fixed10_FP32),
            ("approxMultAccDotProd[FP16, prod + add tree]", approxMultAccDotProd),
            ("approxMultDotProd[FP16 product, exact acc]", approxMultDotProd_FP16_FP32),
            ("bulkNormDotProd [Fixed15, FP32]", bulkNormDotProd_fixed15_FP32),
            ("bulkNormDotProd [Fixed20, FP32]", bulkNormDotProd_fixed20_FP32),
            ("bulkNormDotProd [Fixed25, FP32]", bulkNormDotProd_fixed25_FP32),
            ("bulkNormDotProd [Fixed30, FP32]", bulkNormDotProd_fixed30_FP32),
            ("approxMultDotProd[FP32 product, exact acc]", approxMultDotProd_FP32_FP32),
        ]:

            abs_errors, rel_errors = evaluateErrors(v, func, golden_values)


            assert(len(abs_errors) == len(rel_errors) == n)


            ax.scatter(list(range(len(v))), sorted(rel_errors), marker='x', label=f"{label} relative error")
            
            print(f"{label}:")
            print(f"  absolute: max={max(abs_errors):.3e}, min={min(abs_errors):.3e}, median={statistics.median(abs_errors)}")
            print(f"  relative: max={max(rel_errors):.3e}, min={min(rel_errors):.3e}, median={statistics.median(rel_errors)}")
            print(f"    exact ratio={len(list(filter(lambda x: x == 0, rel_errors))) / len(rel_errors):.3f}")

        #
        fp32_abs_errors, fp32_rel_errors = evaluateErrors(v, approxMultDotProd_FP32_FP32, golden_values)
        fixed25_abs_errors, fixed25_rel_errors = evaluateErrors(v, bulkNormDotProd_fixed25_FP32, golden_values)

        max_error, max_error_index = max((e, i) for (i, e) in enumerate(a - b for (a, b) in zip(fp32_rel_errors, fixed25_rel_errors)))
        print(f"max error at index {max_error_index}: {max_error:.3e} (FP32={fp32_rel_errors[max_error_index]:.3e}, Fixed25={fixed25_rel_errors[max_error_index]:.3e})")
        print(f"value at max error: {v[max_error_index]}")
        print(f"cancellation metric: {cancellationMetric(v[max_error_index])}")


        box = ax.get_position()
        ax.set_position([box.x0, box.y0 + box.height * 0.5,
                        box.width, box.height * 0.5])
        ax.legend(loc='upper center', bbox_to_anchor=(0.5, -0.2),
          fancybox=True, shadow=True, ncol=1)

        ax.set_xlabel("sorted errors")
        ax.set_ylabel("error")
        ax.set_yscale("log")
        plt.savefig(args.out)
        plt.close()


    v = 1.125
    print(f"v={v}, rod={roundToOddFixed(v, -3)}")
    print(f"v={v}, rod={roundToOddFixed(v, -1)}")
    print(f"v={v}, rod={roundToOddFixed(v, -4)}")
    print(f"v={v}, rod={roundToOdd(v, 2)}")
    print(f"v={v}, rod={roundToOdd(v, 4)}")

    v = 1.125 * 0.25
    print(f"v={v}, rod={roundToOddFixed(v, -3)}")
    print(f"v={v}, rod={roundToOddFixed(v, -1)}")
    print(f"v={v}, rod={roundToOddFixed(v, -4)}")
    print(f"v={v}, rod={roundToOdd(v, 2)}")
    print(f"v={v}, rod={roundToOdd(v, 4)}")

    v = -1.125
    print(f"v={v}, rod={roundToOddFixed(v, -3)}")
    print(f"v={v}, rod={roundToOddFixed(v, -1)}")
    print(f"v={v}, rod={roundToOddFixed(v, -4)}")
    print(f"v={v}, rod={roundToOdd(v, 2)}")
    print(f"v={v}, rod={roundToOdd(v, 4)}")