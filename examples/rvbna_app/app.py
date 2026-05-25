from flask import Flask, request, jsonify, send_from_directory
from rvbna_web import (
    correctlyRoundedDotProd,
    approxMultDotProd,
    approxMultAccDotProd,
    fmaDotProd,
    bulkNormDotProd,
    generate_vectors,
    evaluate_errors,
    FORMAT_MAP,
    singleformat,
    halfprecisionformat,
)

app = Flask(__name__, static_folder="static")


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/api/evaluate", methods=["POST"])
def evaluate():
    data = request.json

    # Distribution config
    n = int(data.get("n", 1000))
    k = int(data.get("k", 2))
    average = float(data.get("average", 5.0))
    sigma = float(data.get("sigma", 5.0))
    input_prec_name = data.get("inputPrec", "fp16")
    input_prec = FORMAT_MAP.get(input_prec_name, halfprecisionformat)

    # Clamp n to avoid extreme computation
    n = min(n, 50000)

    # Generate random vectors
    vectors = generate_vectors(n, k, average, sigma, input_prec=input_prec)

    # Generate golden values (exact dot product)
    golden_values = [correctlyRoundedDotProd(a, b) for (a, b) in vectors]

    results = {}
    schemes = data.get("schemes", [])

    for scheme in schemes:
        name = scheme.get("name")
        variant = scheme.get("variant")

        if variant == "exact":
            res = evaluate_errors(vectors, correctlyRoundedDotProd, {}, golden_values)
            results[name] = res

        elif variant == "approx_mult":
            mult_prec_name = scheme.get("multPrec", "fp16")
            res_prec_name = scheme.get("resPrec", "fp32")
            res = evaluate_errors(vectors, approxMultDotProd, {
                "multPrec": FORMAT_MAP.get(mult_prec_name, halfprecisionformat),
                "resPrec": FORMAT_MAP.get(res_prec_name, singleformat),
            }, golden_values)
            results[name] = res

        elif variant == "approx_mult_acc":
            mult_prec_name = scheme.get("multPrec", "fp16")
            add_prec_name = scheme.get("addPrec", "fp16")
            res_prec_name = scheme.get("resPrec", "fp32")
            res = evaluate_errors(vectors, approxMultAccDotProd, {
                "multPrec": FORMAT_MAP.get(mult_prec_name, halfprecisionformat),
                "addPrec": FORMAT_MAP.get(add_prec_name, halfprecisionformat),
                "resPrec": FORMAT_MAP.get(res_prec_name, singleformat),
            }, golden_values)
            results[name] = res

        elif variant == "fma":
            prec_name = scheme.get("fmaPrec", "fp32")
            res_prec_name = scheme.get("resPrec", "fp32")
            res = evaluate_errors(vectors, fmaDotProd, {
                "prec": FORMAT_MAP.get(prec_name, singleformat),
                "resPrec": FORMAT_MAP.get(res_prec_name, singleformat),
            }, golden_values)
            results[name] = res

        elif variant == "bulk_norm":
            bulk_norm_prec = int(scheme.get("bulkNormPrec", 25))
            final_prec = int(scheme.get("finalPrec", 24))
            res = evaluate_errors(vectors, bulkNormDotProd, {
                "bulkNormPrec": bulk_norm_prec,
                "finalPrec": final_prec,
            }, golden_values)
            results[name] = res

    return jsonify(results)


if __name__ == "__main__":
    app.run(debug=True, port=5001)
